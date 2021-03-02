import EventEmitter from "events";
import { FlashDataSource } from "../fs/fs";
import { BoardId } from "./board-id";
import { PartialFlashing } from "./partial-flashing";

/**
 * Specific identified connection error types.
 * New members will be added to this enum over time.
 */
export enum ConnectionErrorType {
  UNABLE_TO_CLAIM_INTERFACE = "UNABLE_TO_CLAIM_INTERFACE",
  UNKNOWN = "UNKNOWN",
}

/**
 * Tracks WebUSB connection status.
 */
export enum ConnectionStatus {
  /**
   * Not supported.
   */
  NOT_SUPPORTED = "NOT_SUPPORTED",
  /**
   * Supported but no device available.
   *
   * This will be the case even when a device is physically connected
   * but has not been connected via the browser security UI.
   */
  NO_AUTHORIZED_DEVICE = "NO_DEVICE",
  /**
   * Authorized device available but we haven't connected to it.
   */
  NOT_CONNECTED = "NOT_CONNECTED",
  /**
   * Connected.
   */
  CONNECTED = "CONNECTED",
}

/**
 * Controls whether a request to connect can prompt the user.
 */
export enum ConnectionMode {
  /**
   * Prompt the user to connect if required.
   */
  INTERACTIVE,
  /**
   * Connect only to a pre-approved device without prompting the user.
   */
  NON_INTERACTIVE,
}

export interface MicrobitConnectionOptions {
  /**
   * Connect when a device becomes available.
   * For example, a previously approved device is plugged in.
   *
   * Default is true.
   */
  autoConnect: boolean;

  /**
   * Device identification.
   *
   * Default matches the micro:bit device.
   */
  deviceFilters: USBDeviceFilter[];
}

export const EVENT_STATUS = "status";
export const EVENT_SERIAL_DATA = "serial_data";
export const EVENT_SERIAL_ERROR = "serial_error";
export const EVENT_AUTOCONNECT_ERROR = "autoconnect_error";
export const EVENT_PROGRESS = "progress";

/**
 * A WebUSB connection to a micro:bit device.
 */
export class MicrobitWebUSBConnection extends EventEmitter {
  status: ConnectionStatus = navigator.usb
    ? ConnectionStatus.NO_AUTHORIZED_DEVICE
    : ConnectionStatus.NOT_SUPPORTED;

  private connection: PartialFlashing = new PartialFlashing();
  private options: MicrobitConnectionOptions;

  constructor(options: Partial<MicrobitConnectionOptions> = {}) {
    super();
    this.options = {
      autoConnect: true,
      deviceFilters: [{ vendorId: 0x0d28, productId: 0x0204 }],
      ...options,
    };
  }

  async initialize(): Promise<void> {
    if (navigator.usb) {
      // navigator.usb.addEventListener("disconnect", this.handleDisconnect);
      // navigator.usb.addEventListener("connect", this.handleConnect);
    }
    const device = await this.getPairedDevice();
    if (device) {
      this.setStatus(ConnectionStatus.NOT_CONNECTED);
      if (this.options.autoConnect) {
        // Do this in the background so all autoconnection errors are reported
        // via the event rather than a mixture.
        this.connect(ConnectionMode.NON_INTERACTIVE).catch((e) => {
          this.emit(EVENT_AUTOCONNECT_ERROR, e);
        });
      }
    }
  }

  /**
   * Removes all listeners.
   */
  dispose() {
    this.removeAllListeners();
    if (navigator.usb) {
      navigator.usb.removeEventListener("connect", this.handleConnect);
      navigator.usb.removeEventListener("disconnect", this.handleDisconnect);
    }
  }

  /**
   * Connects to a currently paired device or requests pairing.
   * Throws on error.
   *
   * @param interactive whether we can prompt the user to choose a device.
   * @returns the final connection status.
   */
  async connect(mode: ConnectionMode): Promise<ConnectionStatus> {
    return withEnrichedErrors(async () => {
      this.setStatus(await this.connectInternal(mode));
      return this.status;
    });
  }

  async flash(
    dataSource: FlashDataSource,
    options: {
      partial: boolean;
      progress: (percentage: number | undefined) => void;
    }
  ): Promise<void> {
    const partial = options.partial;
    const progress = options.progress || (() => {});

    // When we support it:
    // this.stopSerialRead();

    // Things to reinstate:
    //   - FS space error handling.
    //   - Overall timeout code.
    //   - unhandledrejection wrapper. To discuss! Does it really fail in the background?
    //   - The error handler disconnects and throws away dapjs.

    await this.connection.disconnectDapAsync();
    await this.connection.connectDapAsync();

    // Collect data to flash, partial flashing can use just the flash bytes,
    // but full flashing needs the entire Intel Hex to include the UICR data
    const boardId = BoardId.parse(this.connection.dapwrapper.boardId);
    const data = await dataSource(boardId);
    // TODO: push this decision down
    if (partial) {
      await this.connection.flashAsync(data.bytes, data.intelHex, progress);
    } else {
      await this.connection.fullFlashAsync(data.intelHex, progress);
    }
    progress(undefined);
  }

  /**
   * Disconnect from the device.
   */
  async disconnect(): Promise<void> {
    await withEnrichedErrors(async () => {
      await this.connection.disconnectDapAsync();
      this.setStatus(ConnectionStatus.NOT_CONNECTED);
    });
  }

  private async getPairedDevice(): Promise<USBDevice | undefined> {
    if (!navigator.usb) {
      return undefined;
    }
    const devices = (await navigator.usb.getDevices()).filter(
      this.matchesDeviceFilter
    );
    return devices.length === 1 ? devices[0] : undefined;
  }

  private assertSupported() {
    if (!navigator.usb) {
      throw new Error("Unsupported. Check connection status first.");
    }
  }

  private setStatus(newStatus: ConnectionStatus) {
    this.status = newStatus;
    this.emit(EVENT_STATUS, this.status);
  }

  private handleConnect = (event: USBConnectionEvent) => {
    if (this.matchesDeviceFilter(event.device)) {
      if (this.status === ConnectionStatus.NO_AUTHORIZED_DEVICE) {
        this.setStatus(ConnectionStatus.NOT_CONNECTED);
        if (this.options.autoConnect) {
          this.connect(ConnectionMode.NON_INTERACTIVE).catch((e) =>
            this.emit(EVENT_SERIAL_ERROR, e)
          );
        }
      }
    }
  };

  private handleDisconnect = (event: USBConnectionEvent) => {
    if (event.device === this.connection.dapwrapper?.daplink?.device) {
      this.setStatus(ConnectionStatus.NO_AUTHORIZED_DEVICE);
    }
  };

  private async connectInternal(
    mode: ConnectionMode
  ): Promise<ConnectionStatus> {
    this.assertSupported();
    await this.connection.connectDapAsync();
    // What about this case: ConnectionStatus.NO_AUTHORIZED_DEVICE
    return ConnectionStatus.CONNECTED;
  }

  private matchesDeviceFilter = (device: USBDevice): boolean =>
    this.options.deviceFilters.some((filter) => {
      return (
        (typeof filter.productId === "undefined" ||
          filter.productId === device.productId) &&
        (typeof filter.vendorId === "undefined" ||
          filter.vendorId === device.vendorId)
      );
    });
}

async function withEnrichedErrors<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw enrichedError(e);
  }
}

// tslint:disable-next-line: no-any
const enrichedError = (e: any): Error => {
  if (!(e instanceof Error)) {
    // tslint:disable-next-line: no-ex-assign
    e = new Error(e);
  }
  const specialCases: Record<
    string,
    { type: ConnectionErrorType; message: string }
  > = {
    // Occurs when another window/tab is using WebUSB.
    "Unable to claim interface.": {
      type: ConnectionErrorType.UNABLE_TO_CLAIM_INTERFACE,
      message:
        "Cannot connect. Check no other browser tabs or windows are using the micro:bit.",
    },
  };
  const special = specialCases[e.message];
  if (special) {
    e = new Error(special.message);
    e.type = special.type;
  } else {
    e.type = ConnectionErrorType.UNKNOWN;
  }
  return e;
};
