// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Accordion, AccordionItem } from "@heroui/accordion";
import { Alert } from "@heroui/alert";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Checkbox } from "@heroui/checkbox";
import { Chip } from "@heroui/chip";
import { Code } from "@heroui/code";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/modal";
import React from "react";

interface ToolApprovalModalProps {
  isOpen: boolean;
  tool?: {
    name: string;
    args: Record<string, unknown>;
    description?: string;
  };
  serverName?: string;
  isAutoApproved: boolean;
  onApprove: () => void;
  onReject: () => void;
  onToggleAutoApproval: () => void;
}

export const ToolApprovalModal: React.FC<ToolApprovalModalProps> = ({
  isOpen,
  tool,
  serverName,
  isAutoApproved,
  onApprove,
  onReject,
  onToggleAutoApproval
}) => {
  if (!tool) return null;

  const formatArguments = (args: Record<string, unknown>) => {
    return Object.entries(args).map(([key, value]) => {
      let displayValue: string;

      if (typeof value === "object") {
        displayValue = JSON.stringify(value, null, 2);
      } else if (typeof value === "string" && value.length > 100) {
        displayValue = value.substring(0, 100) + "...";
      } else {
        displayValue = String(value);
      }

      return { key, value: displayValue };
    });
  };

  const argumentEntries = formatArguments(tool.args);

  return (
    <Modal hideCloseButton isDismissable={false} isOpen={isOpen} size="2xl">
      <ModalContent>
        <>
          <ModalHeader>Tool Execution Approval Required</ModalHeader>

          <ModalBody className="gap-4">
            {/* Warning */}
            <Alert
              color="warning"
              description="The AI is requesting to execute a tool. Review the details below and only approve if you trust the operation being performed."
              title="Review carefully"
              variant="faded"
            />

            {/* Tool Information */}
            <Card>
              <CardBody className="gap-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-medium">{tool.name}</h4>
                    {tool.description && (
                      <p className="text-small text-default-600 mt-1">
                        {tool.description}
                      </p>
                    )}
                  </div>
                  {serverName && (
                    <Chip color="primary" size="sm" variant="flat">
                      {serverName}
                    </Chip>
                  )}
                </div>

                {argumentEntries.length > 0 && (
                  <Accordion className="px-0" variant="light">
                    <AccordionItem
                      key="arguments"
                      aria-label="Arguments"
                      title={
                        <span className="text-small font-medium">
                          Arguments ({argumentEntries.length})
                        </span>
                      }
                    >
                      <div className="space-y-2">
                        {argumentEntries.map(({ key, value }) => (
                          <div key={key} className="flex flex-col gap-1">
                            <span className="text-small font-medium text-default-700">
                              {key}:
                            </span>
                            <Code className="text-xs max-w-full whitespace-pre-wrap">
                              {value}
                            </Code>
                          </div>
                        ))}
                      </div>
                    </AccordionItem>
                  </Accordion>
                )}
              </CardBody>
            </Card>

            {/* Auto-approval option */}
            <div className="bg-default-50 p-3 rounded-medium">
              <Checkbox
                isSelected={isAutoApproved}
                size="sm"
                onValueChange={() => onToggleAutoApproval()}
              >
                <span className="text-small">
                  Auto-approve this tool in the future
                </span>
              </Checkbox>
              <p className="text-tiny text-default-500 mt-1 ml-6">
                If enabled, this tool will be automatically approved without
                asking for permission
              </p>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button variant="light" onPress={onReject}>
              Deny
            </Button>
            <Button color="primary" onPress={onApprove}>
              Approve
            </Button>
          </ModalFooter>
        </>
      </ModalContent>
    </Modal>
  );
};
