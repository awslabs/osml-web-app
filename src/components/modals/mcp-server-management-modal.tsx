// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Button } from "@heroui/button";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from "@heroui/modal";
import { Switch } from "@heroui/switch";
import { Tooltip } from "@heroui/tooltip";
import { useDispatch, useSelector } from "react-redux";

import { AddServerModal } from "@/components/mcp/add-server-modal";
import { McpServerManagement } from "@/components/mcp/mcp-server-management";
import { McpPreferences, McpServerConfig } from "@/hooks/use-mcp";
import {
  addServerWithToken,
  removeServer,
  selectMcpPreferences,
  selectMcpServers,
  updatePreferences,
  updateServer
} from "@/store/slices/mcp-slice";
import { AppDispatch } from "@/store/store";

interface McpServerManagementModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export const McpServerManagementModal = ({
  isOpen,
  onOpenChange
}: McpServerManagementModalProps) => {
  const dispatch = useDispatch<AppDispatch>();
  const mcpServers = useSelector(selectMcpServers);
  const mcpPreferences = useSelector(selectMcpPreferences);

  const {
    isOpen: isAddServerOpen,
    onOpen: onOpenAddServer,
    onClose: onCloseAddServer
  } = useDisclosure();

  const handleUpdateServers = (servers: McpServerConfig[]) => {
    servers.forEach((server) => {
      const existing = mcpServers.find((s) => s.id === server.id);
      if (existing) {
        dispatch(updateServer(server));
      }
    });

    mcpServers.forEach((existing) => {
      if (!servers.find((s) => s.id === existing.id)) {
        dispatch(removeServer(existing.id));
      }
    });
  };

  const handleUpdatePreferences = (preferences: McpPreferences) => {
    dispatch(updatePreferences(preferences));
  };

  const handleToggleOverrideApprovals = () => {
    dispatch(
      updatePreferences({
        ...mcpPreferences,
        overrideAllApprovals: !mcpPreferences.overrideAllApprovals
      })
    );
  };

  const handleAddServer = (server: McpServerConfig, customToken?: string) => {
    dispatch(addServerWithToken(server, customToken));
  };

  return (
    <>
      <Modal
        hideCloseButton
        isDismissable={false}
        isOpen={isOpen}
        size="4xl"
        onOpenChange={onOpenChange}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>MCP Server Management</ModalHeader>
              <ModalBody className="gap-4">
                <McpServerManagement
                  preferences={mcpPreferences}
                  servers={mcpServers}
                  onAddServer={onOpenAddServer}
                  onUpdatePreferences={handleUpdatePreferences}
                  onUpdateServers={handleUpdateServers}
                />
              </ModalBody>
              <ModalFooter>
                <div className="flex items-center justify-between w-full">
                  <Tooltip content="Auto-approve all tool executions">
                    <div className="flex items-center gap-2">
                      <Switch
                        isSelected={mcpPreferences.overrideAllApprovals}
                        size="sm"
                        onValueChange={handleToggleOverrideApprovals}
                      />
                      <span className="text-small">Auto-approve all</span>
                    </div>
                  </Tooltip>
                  <Button variant="light" onPress={onClose}>
                    Close
                  </Button>
                </div>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <AddServerModal
        isOpen={isAddServerOpen}
        onAdd={handleAddServer}
        onClose={onCloseAddServer}
      />
    </>
  );
};
