/**
 * (c) 2022, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import {
  Box,
  Button,
  Fade,
  Flex,
  HStack,
  IconButton,
  Link,
  Modal,
  ModalBody,
  ModalContent,
  ModalOverlay,
  useDisclosure,
} from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RiCloseLine, RiDownloadLine, RiSearch2Line } from "react-icons/ri";
import { useIntl } from "react-intl";
import CollapsibleButton from "../common/CollapsibleButton";
import { useResizeObserverContentRect } from "../common/use-resize-observer";
import { zIndexSidebarHeader } from "../common/zIndex";
import { useDeployment } from "../deployment";
import { topBarHeight } from "../deployment/misc";
import { useSearch } from "../documentation/search/search-hooks";
import SearchDialog from "../documentation/search/SearchDialog";
import { useLogging } from "../logging/logging-hooks";
import { RouterState, useRouterState } from "../router-hooks";

interface SideBarHeaderProps {
  sidebarShown: boolean;
  onSidebarToggled: () => void;
}

const SideBarHeader = ({
  sidebarShown,
  onSidebarToggled,
}: SideBarHeaderProps) => {
  const intl = useIntl();
  const logging = useLogging();
  const brand = useDeployment();
  const searchModal = useDisclosure();
  const { results, query, setQuery } = useSearch();
  const [, setRouterState] = useRouterState();
  const [viewedResults, setViewedResults] = useState<string[]>([]);
  const collapseBtn = useDisclosure({ defaultIsOpen: true });

  const handleModalOpened = useCallback(() => {
    collapseBtn.onClose();
    searchModal.onOpen();
  }, [collapseBtn, searchModal]);

  const handleModalClosed = useCallback(() => {
    collapseBtn.onOpen();
    searchModal.onClose();
  }, [collapseBtn, searchModal]);

  const handleCollapseBtnClick = useCallback(() => {
    logging.event({
      type: "sidebar-toggle",
      message: !sidebarShown ? "open" : "close",
    });
    onSidebarToggled();
  }, [logging, onSidebarToggled, sidebarShown]);

  // When we add more keyboard shortcuts, we should pull this up and have a CM-like model of the
  // available actions and their shortcuts, with a hook used here to register a handler for the action.
  useEffect(() => {
    const isMac = /Mac/.test(navigator.platform);
    const keydown = (e: KeyboardEvent) => {
      if (
        (e.key === "F" || e.key === "f") &&
        (isMac ? e.metaKey : e.ctrlKey) &&
        e.shiftKey &&
        !e.repeat
      ) {
        handleModalOpened();
        if (!sidebarShown) {
          onSidebarToggled();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
    };
  }, [onSidebarToggled, searchModal, sidebarShown, handleModalOpened]);

  const handleQueryChange: React.ChangeEventHandler<HTMLInputElement> =
    useCallback(
      (e) => {
        const newQuery = e.currentTarget.value;
        setQuery(newQuery);
      },
      [setQuery]
    );

  const handleClear = useCallback(() => {
    setQuery("");
    setViewedResults([]);
  }, [setQuery]);

  const handleViewResult = useCallback(
    (id: string, navigation: RouterState) => {
      if (!viewedResults.includes(id)) {
        setViewedResults([...viewedResults, id]);
      }
      handleModalClosed();
      // Create new RouterState object to enforce navigation when clicking the same entry twice.
      const routerState: RouterState = JSON.parse(JSON.stringify(navigation));
      setRouterState(routerState, "documentation-search");
    },
    [setViewedResults, viewedResults, setRouterState, handleModalClosed]
  );

  useEffect(() => {
    setViewedResults([]);
  }, [results]);

  const ref = useRef<HTMLDivElement>(null);
  const faceLogoRef = useRef<HTMLDivElement>(null);
  const contentRect = useResizeObserverContentRect(ref);
  const contentWidth = contentRect?.width ?? 0;
  const searchButtonMode =
    !contentWidth || contentWidth > 405 ? "button" : "icon";
  const paddingX = 14;
  const modalOffset = faceLogoRef.current
    ? faceLogoRef.current.getBoundingClientRect().right + paddingX
    : 0;
  const modalWidth = contentWidth - modalOffset + "px";
  return (
    <>
      {searchModal.isOpen && (
        <Modal
          isOpen={searchModal.isOpen}
          onClose={handleModalClosed}
          size="lg"
        >
          <ModalOverlay>
            <ModalContent
              mt={3.5}
              ml={modalOffset + "px"}
              width={modalWidth}
              containerProps={{
                justifyContent: "flex-start",
              }}
              p={1}
              borderRadius="20px"
              maxWidth="unset"
              maxHeight="unset"
            >
              <ModalBody p={0}>
                <SearchDialog
                  results={results}
                  query={query}
                  onQueryChange={handleQueryChange}
                  onClear={handleClear}
                  viewedResults={viewedResults}
                  onViewResult={handleViewResult}
                />
              </ModalBody>
            </ModalContent>
          </ModalOverlay>
        </Modal>
      )}
      <Flex
        ref={ref}
        backgroundColor="brand.500"
        boxShadow="0px 4px 16px #00000033"
        zIndex={zIndexSidebarHeader}
        height={searchModal.isOpen ? "5.5rem" : topBarHeight}
        alignItems="center"
        justifyContent="space-between"
        pr={4}
        transition="height .2s"
        position="relative"
      >
        <Link
          display="block"
          href="https://microbit.org/code/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={intl.formatMessage({ id: "visit-dot-org" })}
        >
          <HStack spacing={3.5} pl={4} pr={4}>
            <Box width="3.56875rem" color="white" role="img" ref={faceLogoRef}>
              {brand.squareLogo}
            </Box>
            {!query && sidebarShown && (
              <Box width="9.098rem" role="img" color="white">
                {brand.horizontalLogo}
              </Box>
            )}
          </HStack>
        </Link>
        {!query && sidebarShown && (
          <CollapsibleButton
            onClick={handleModalOpened}
            backgroundColor="#5c40a6"
            fontWeight="normal"
            color="#fffc"
            icon={<Box as={RiSearch2Line} fontSize="lg" color="fff" />}
            fontSize="sm"
            _hover={{}}
            _active={{}}
            border="unset"
            textAlign="left"
            p={3}
            pr={`min(${contentWidth / 50}%, var(--chakra-space-20))`}
            _collapsed={{
              pr: 3,
            }}
            text={intl.formatMessage({ id: "search" })}
            mode={searchButtonMode}
            mr="2rem"
          />
        )}
        {query && sidebarShown && (
          <Flex
            backgroundColor="white"
            borderRadius="3xl"
            width={`calc(100% - ${modalOffset}px - 28px)`}
            marginRight="28px"
            position="relative"
          >
            <Button
              _active={{}}
              _hover={{}}
              border="unset"
              color="gray.800"
              flex={1}
              fontSize="md"
              fontWeight="normal"
              justifyContent="flex-start"
              leftIcon={
                <Box as={RiSearch2Line} fontSize="lg" color="#838383" />
              }
              onClick={handleModalOpened}
              overflow="hidden"
            >
              {query}
            </Button>
            <IconButton
              aria-label={intl.formatMessage({ id: "clear" })}
              backgroundColor="white"
              // Also used for Zoom, move to theme.
              color="#838383"
              fontSize="2xl"
              icon={<RiCloseLine />}
              isRound={false}
              onClick={handleClear}
              position="absolute"
              right="0"
              pr={3}
              pl={3}
              variant="ghost"
            />
          </Flex>
        )}
        <Flex
          height="100%"
          alignItems="center"
          position="absolute"
          width="28px"
          right={sidebarShown ? "4px" : "-20px"}
        >
          <Fade in={collapseBtn.isOpen} initial={{ opacity: 1 }}>
            <IconButton
              aria-label={
                sidebarShown
                  ? intl.formatMessage({ id: "sidebar-collapse" })
                  : intl.formatMessage({ id: "sidebar-expand" })
              }
              fontSize="xl"
              icon={<RiDownloadLine />}
              transform={sidebarShown ? "rotate(90deg)" : "rotate(270deg)"}
              transition="none"
              onClick={handleCollapseBtnClick}
              borderTopLeftRadius={0}
              borderTopRightRadius={0}
              borderBottomRightRadius={6}
              borderBottomLeftRadius={6}
              py={3}
              borderColor="black"
              size="md"
              height="20px"
              background="#eaecf1"
              color="brand.500"
              variant="ghost"
            />
          </Fade>
        </Flex>
      </Flex>
    </>
  );
};

export default SideBarHeader;
