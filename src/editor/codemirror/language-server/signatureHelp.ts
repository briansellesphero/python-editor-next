/**
 * Signature help. This shows a documentation tooltip when a user is
 * writing a function signature. Currently triggered by the opening
 * bracket.
 *
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { StateEffect, StateField } from "@codemirror/state";
import { showTooltip, Tooltip } from "@codemirror/tooltip";
import {
  Command,
  EditorView,
  KeyBinding,
  keymap,
  logException,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { IntlShape } from "react-intl";
import {
  MarkupContent,
  SignatureHelp,
  SignatureHelpParams,
  SignatureHelpRequest,
} from "vscode-languageserver-protocol";
import { ApiReferenceMap } from "../../../documentation/mapping/content";
import { BaseLanguageServerView, clientFacet, uriFacet } from "./common";
import {
  DocSections,
  getLinkToReference,
  renderDocumentation,
  wrapWithDocumentationButton,
} from "./documentation";
import { nameFromSignature, removeFullyQualifiedName } from "./names";
import { offsetToPosition } from "./positions";

interface SignatureChangeEffect {
  pos: number;
  result: SignatureHelp | null;
}

export const setSignatureHelpEffect = StateEffect.define<SignatureChangeEffect>(
  {}
);

interface SignatureHelpState {
  tooltip: Tooltip | null;
  result: SignatureHelp | null;
}

const signatureHelpToolTipBaseTheme = EditorView.baseTheme({
  ".cm-tooltip.cm-signature-tooltip": {
    padding: "3px 9px",
    width: "max-content",
    maxWidth: "500px",
  },
  ".cm-tooltip .cm-signature-activeParameter": {
    fontWeight: "bold",
  },
});

const closeSignatureHelp: Command = (view: EditorView) => {
  view.dispatch({
    effects: setSignatureHelpEffect.of({
      pos: -1,
      result: null,
    }),
  });
  return true;
};

const triggerSignatureHelpRequest = async (view: EditorView): Promise<void> => {
  const uri = view.state.facet(uriFacet)!;
  const client = view.state.facet(clientFacet)!;
  const pos = view.state.selection.main.from;
  const params: SignatureHelpParams = {
    textDocument: { uri },
    position: offsetToPosition(view.state.doc, pos),
  };
  try {
    const result = await client.connection.sendRequest(
      SignatureHelpRequest.type,
      params
    );
    view.dispatch({
      effects: [setSignatureHelpEffect.of({ pos, result })],
    });
  } catch (e) {
    logException(view.state, e, "signature-help");
    view.dispatch({
      effects: [setSignatureHelpEffect.of({ pos, result: null })],
    });
  }
};

const openSignatureHelp: Command = (view: EditorView) => {
  triggerSignatureHelpRequest(view);
  return true;
};

const signatureHelpKeymap: readonly KeyBinding[] = [
  // This matches VS Code.
  { key: "Mod-Shift-Space", run: openSignatureHelp },
  { key: "Escape", run: closeSignatureHelp },
];

export const signatureHelp = (
  intl: IntlShape,
  automatic: boolean,
  apiReferenceMap: ApiReferenceMap
) => {
  const signatureHelpTooltipField = StateField.define<SignatureHelpState>({
    create: () => ({
      result: null,
      tooltip: null,
    }),
    update(state, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setSignatureHelpEffect)) {
          return reduceSignatureHelpState(state, effect.value, apiReferenceMap);
        }
      }
      return state;
    },
    provide: (f) => showTooltip.from(f, (val) => val.tooltip),
  });

  class SignatureHelpView
    extends BaseLanguageServerView
    implements PluginValue
  {
    constructor(view: EditorView, private automatic: boolean) {
      super(view);
    }
    update({ docChanged, selectionSet, transactions }: ViewUpdate) {
      if (
        (docChanged || selectionSet) &&
        this.view.state.field(signatureHelpTooltipField).tooltip
      ) {
        triggerSignatureHelpRequest(this.view);
      } else if (this.automatic && docChanged) {
        const last = transactions[transactions.length - 1];

        // This needs to trigger for autocomplete adding function parens
        // as well as normal user input with `closebrackets` inserting
        // the closing bracket.
        if (last.isUserEvent("input") || last.isUserEvent("dnd.drop.call")) {
          last.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
            if (inserted.sliceString(0).trim().endsWith("()")) {
              triggerSignatureHelpRequest(this.view);
            }
          });
        }
      }
    }
  }

  const reduceSignatureHelpState = (
    state: SignatureHelpState,
    effect: SignatureChangeEffect,
    apiReferenceMap: ApiReferenceMap
  ): SignatureHelpState => {
    if (state.tooltip && !effect.result) {
      return {
        result: null,
        tooltip: null,
      };
    }
    // It's a bit weird that we always update the position, but VS Code does this too.
    // I think ideally we'd have a notion of "same function call". Does the
    // node have a stable identity?
    if (effect.result) {
      const result = effect.result;
      return {
        result,
        tooltip: {
          pos: effect.pos,
          above: true,
          // This isn't great but the impact is really bad when it conflicts with autocomplete.
          // strictSide: true,
          create: () => {
            const dom = document.createElement("div");
            dom.className = "cm-signature-tooltip";
            dom.appendChild(formatSignatureHelp(result, apiReferenceMap));
            return { dom };
          },
        },
      };
    }
    return state;
  };

  const formatSignatureHelp = (
    help: SignatureHelp,
    apiReferenceMap: ApiReferenceMap
  ): Node => {
    const { activeSignature: activeSignatureIndex, signatures } = help;
    // We intentionally do something minimal here to minimise distraction.
    const activeSignature =
      activeSignatureIndex === null
        ? signatures[0]
        : signatures[activeSignatureIndex!];
    const {
      label,
      parameters,
      documentation: signatureDoc,
      activeParameter: activeParameterIndex,
    } = activeSignature;
    const activeParameter =
      activeParameterIndex !== undefined && parameters
        ? parameters[activeParameterIndex]
        : undefined;
    const activeParameterLabel = activeParameter?.label;
    const activeParameterDoc = activeParameter?.documentation;
    if (typeof activeParameterLabel === "string") {
      throw new Error("Not supported");
    }
    let from = label.length;
    let to = label.length;
    if (Array.isArray(activeParameterLabel)) {
      [from, to] = activeParameterLabel;
    }
    return formatHighlightedParameter(
      label,
      from,
      to,
      signatureDoc,
      activeParameterDoc,
      apiReferenceMap
    );
  };

  const formatHighlightedParameter = (
    label: string,
    from: number,
    to: number,
    signatureDoc: string | MarkupContent | undefined,
    activeParameterDoc: string | MarkupContent | undefined,
    apiReferenceMap: ApiReferenceMap
  ): Node => {
    let before = label.substring(0, from);
    const id = nameFromSignature(before);
    const parameter = label.substring(from, to);
    const after = label.substring(to);

    // Do this after using the indexes, not to the original label.
    before = removeFullyQualifiedName(before);

    const parent = document.createElement("div");
    parent.className = "docs-spacing";
    const signature = parent.appendChild(document.createElement("code"));
    signature.className = "cm-signature-signature";
    signature.appendChild(document.createTextNode(before));
    const span = signature.appendChild(document.createElement("span"));
    span.className = "cm-signature-activeParameter";
    span.appendChild(document.createTextNode(parameter));
    signature.appendChild(document.createTextNode(after));
    parent.appendChild(document.createElement("hr"));

    if (activeParameterDoc) {
      parent.appendChild(
        renderDocumentation(activeParameterDoc, DocSections.All)
      );
      parent.appendChild(
        renderDocumentation(signatureDoc, DocSections.Example)
      );
    } else {
      // No params so show summary and example from the signature docstring.
      parent.appendChild(
        renderDocumentation(
          signatureDoc,
          DocSections.Summary | DocSections.Example
        )
      );
    }
    const referenceLink = getLinkToReference(id, apiReferenceMap);
    return wrapWithDocumentationButton(intl, parent, id, referenceLink);
  };

  return [
    // View only handles automatic triggering.
    ViewPlugin.define((view) => new SignatureHelpView(view, automatic)),
    signatureHelpTooltipField,
    signatureHelpToolTipBaseTheme,
    keymap.of(signatureHelpKeymap),
  ];
};
