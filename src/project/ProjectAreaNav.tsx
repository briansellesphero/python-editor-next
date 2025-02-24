/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import NewButton from "./NewButton";
import OpenButton from "./OpenButton";
import { BoxProps, Flex } from "@chakra-ui/react";

const ProjectAreaNav = (props: BoxProps) => {
  return (
    <Flex
      px={2}
      spacing={0}
      flexWrap="wrap"
      justifyContent="flex-end"
      {...props}
    >
      <NewButton mode="button" my={1} mx={1} />
      <OpenButton mode="button" my={1} mx={1} />
    </Flex>
  );
};

export default ProjectAreaNav;
