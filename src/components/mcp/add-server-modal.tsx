// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { Alert } from "@heroui/alert";
import { Button } from "@heroui/button";
import { Input, Textarea } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/modal";
import { Radio, RadioGroup } from "@heroui/radio";
import { useMemo, useState } from "react";

import { McpAuthMode, McpServerConfig } from "@/hooks/use-mcp";
import { validateMcpServerUrl } from "@/utils/mcp-server-validation";

interface AddServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (server: McpServerConfig, customToken?: string) => void;
}

export const AddServerModal = ({
  isOpen,
  onClose,
  onAdd
}: AddServerModalProps) => {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [authMode, setAuthMode] = useState<McpAuthMode>("none");
  const [customToken, setCustomToken] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);

  const urlValidation = useMemo(
    () => (url.trim() ? validateMcpServerUrl(url) : null),
    [url]
  );

  const reset = () => {
    setName("");
    setUrl("");
    setDescription("");
    setAuthMode("none");
    setCustomToken("");
    setTokenVisible(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const canSubmit =
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    urlValidation?.ok === true &&
    (authMode !== "custom" || customToken.trim().length > 0);

  const handleSubmit = () => {
    if (!canSubmit) return;
    const server: McpServerConfig = {
      id: `mcp-server-${Date.now()}`,
      name: name.trim(),
      url: url.trim(),
      description: description.trim() || undefined,
      enabled: true,
      connectionStatus: "active",
      autoApprovedTools: [],
      disabledTools: [],
      authMode
    };
    onAdd(server, authMode === "custom" ? customToken.trim() : undefined);
    reset();
    onClose();
  };

  return (
    <Modal
      hideCloseButton
      isDismissable={false}
      isOpen={isOpen}
      size="2xl"
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <ModalContent>
        <ModalHeader>Add MCP Server</ModalHeader>

        <ModalBody className="gap-4">
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
            description="https:// or wss:// for remote servers; http://localhost permitted for development"
            errorMessage={
              urlValidation && !urlValidation.ok
                ? urlValidation.reason
                : undefined
            }
            isInvalid={urlValidation ? !urlValidation.ok : false}
            label="Server URL"
            placeholder="https://server.example.com/mcp"
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

          <RadioGroup
            label="Authentication"
            value={authMode}
            onValueChange={(v) => setAuthMode(v as McpAuthMode)}
          >
            <Radio
              description="Server doesn't require authentication"
              value="none"
            >
              None
            </Radio>
            <Radio
              description="Forward your web app session token to this server"
              value="session"
            >
              Use web app session token
            </Radio>
            <Radio
              description="Provide a token that only this server uses"
              value="custom"
            >
              Custom token
            </Radio>
          </RadioGroup>

          {authMode === "session" && (
            <Alert
              color="danger"
              description="This server will receive your authentication token. Only add servers you trust."
              title="Authentication token will be sent"
              variant="faded"
            />
          )}

          {authMode === "custom" && (
            <>
              <Alert
                color="warning"
                description="This token is stored in your browser. Anyone with access to this device can read it."
                title="Token stored in this browser"
                variant="faded"
              />
              <Input
                isRequired
                endContent={
                  <button
                    aria-label={tokenVisible ? "Hide token" : "Show token"}
                    className="focus:outline-none"
                    type="button"
                    onClick={() => setTokenVisible((v) => !v)}
                  >
                    {tokenVisible ? (
                      <EyeSlashIcon className="w-4 h-4 text-default-400" />
                    ) : (
                      <EyeIcon className="w-4 h-4 text-default-400" />
                    )}
                  </button>
                }
                label="Custom Token"
                placeholder="Paste the token issued by this MCP server"
                type={tokenVisible ? "text" : "password"}
                value={customToken}
                variant="bordered"
                onValueChange={setCustomToken}
              />
            </>
          )}
        </ModalBody>

        <ModalFooter>
          <Button color="danger" variant="flat" onPress={handleClose}>
            Cancel
          </Button>
          <Button
            color="primary"
            isDisabled={!canSubmit}
            onPress={handleSubmit}
          >
            Add Server
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
