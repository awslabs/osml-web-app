// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Button } from "@heroui/button";
import { Input, Textarea } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/modal";
import { useState } from "react";

interface AddServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (server: { name: string; url: string; description?: string }) => void;
}

export const AddServerModal = ({
  isOpen,
  onClose,
  onAdd
}: AddServerModalProps) => {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) return;

    setIsLoading(true);
    try {
      await onAdd({
        name: name.trim(),
        url: url.trim(),
        description: description.trim() || undefined
      });

      // Reset form
      setName("");
      setUrl("");
      setDescription("");
      onClose();
    } catch {
      // Server addition failed - parent will handle error display
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setName("");
    setUrl("");
    setDescription("");
    onClose();
  };

  return (
    <Modal isOpen={isOpen} placement="top-center" onOpenChange={handleClose}>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          Add MCP Server
        </ModalHeader>

        <ModalBody>
          <Input
            isRequired
            label="Server Name"
            placeholder="Enter server name"
            value={name}
            variant="bordered"
            onValueChange={setName}
          />

          <Input
            isRequired
            description="WebSocket (ws://) or HTTP (http://) URL for the MCP server"
            label="Server URL"
            placeholder="ws://localhost:3001/mcp or http://localhost:3001/mcp"
            value={url}
            variant="bordered"
            onValueChange={setUrl}
          />

          <Textarea
            label="Description (Optional)"
            maxRows={4}
            minRows={2}
            placeholder="Brief description of what this server provides"
            value={description}
            variant="bordered"
            onValueChange={setDescription}
          />
        </ModalBody>

        <ModalFooter>
          <Button color="danger" variant="flat" onPress={handleClose}>
            Cancel
          </Button>
          <Button
            color="primary"
            isDisabled={!name.trim() || !url.trim()}
            isLoading={isLoading}
            onPress={handleSubmit}
          >
            Add Server
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
