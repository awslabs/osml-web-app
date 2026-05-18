// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Button } from "@heroui/button";
import { Input, Textarea } from "@heroui/input";
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
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { McpServerManagement } from "@/components/mcp/mcp-server-management";
import { McpPreferences, McpServerConfig } from "@/hooks/use-mcp";
import {
  addServer,
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
    onOpenChange: onAddServerOpenChange
  } = useDisclosure();

  const [formData, setFormData] = useState<Partial<McpServerConfig>>({
    id: "",
    name: "",
    url: "",
    description: "",
    enabled: true,
    connectionStatus: "active",
    autoApprovedTools: [],
    disabledTools: []
  });

  // Reset form on add-server modal open.
  const [wasAddServerOpen, setWasAddServerOpen] = useState(isAddServerOpen);
  if (isAddServerOpen !== wasAddServerOpen) {
    setWasAddServerOpen(isAddServerOpen);
    if (isAddServerOpen) {
      setFormData({
        id: "",
        name: "",
        url: "",
        description: "",
        enabled: true,
        connectionStatus: "active",
        autoApprovedTools: [],
        disabledTools: []
      });
    }
  }

  const handleUpdateServers = (servers: McpServerConfig[]) => {
    servers.forEach((server) => {
      const existing = mcpServers.find((s) => s.id === server.id);
      if (existing) {
        dispatch(updateServer(server));
      } else {
        dispatch(addServer(server));
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

  const handleSaveServer = (server: McpServerConfig) => {
    dispatch(addServer(server));

    if (server.enabled) {
      dispatch(
        updatePreferences({
          ...mcpPreferences,
          enabledServers: [...mcpPreferences.enabledServers, server]
        })
      );
    }

    onAddServerOpenChange();
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

      {/* Add Server Form Modal */}
      <Modal
        hideCloseButton
        isDismissable={false}
        isOpen={isAddServerOpen}
        size="2xl"
        onOpenChange={onAddServerOpenChange}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Add New MCP Server</ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  isRequired
                  label="Server Name"
                  placeholder="Enter server name (e.g., OSML Geo Agent)"
                  value={formData.name || ""}
                  variant="bordered"
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                />
                <Input
                  isRequired
                  label="Server URL"
                  placeholder="Enter MCP server URL (e.g., http://localhost:8080)"
                  value={formData.url || ""}
                  variant="bordered"
                  onChange={(e) =>
                    setFormData({ ...formData, url: e.target.value })
                  }
                />
                <Textarea
                  label="Description"
                  placeholder="Optional description of the server's capabilities"
                  value={formData.description || ""}
                  variant="bordered"
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                />
                <Switch
                  isSelected={formData.enabled}
                  onValueChange={(enabled) =>
                    setFormData({ ...formData, enabled })
                  }
                >
                  Enable server by default
                </Switch>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Cancel
                </Button>
                <Button
                  color="primary"
                  isDisabled={!formData.name || !formData.url}
                  onPress={() =>
                    handleSaveServer({
                      ...(formData as McpServerConfig),
                      // Generate the unique id at submit time rather than
                      // during render, since calling Date.now() in the
                      // render path is flagged as impure by the React
                      // Compiler.
                      id: formData.id || `mcp-server-${Date.now()}`
                    })
                  }
                >
                  Add Server
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
};
