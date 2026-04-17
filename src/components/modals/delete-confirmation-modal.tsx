// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Button } from "@heroui/button";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/modal";
import { Spinner } from "@heroui/spinner";
import React from "react";

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleteAction: () => void;
  itemName?: string;
  itemType?: string;
  isLoading?: boolean;
}

export const DeleteConfirmationModal = ({
  isOpen,
  onOpenChange,
  onDeleteAction,
  itemName,
  itemType = "item",
  isLoading = false
}: DeleteConfirmationModalProps) => {
  const displayText = itemName ? `"${itemName}"` : `this ${itemType}`;

  return (
    <Modal
      isDismissable={!isLoading}
      isOpen={isOpen}
      size="sm"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>Confirm Delete</ModalHeader>
            <ModalBody>
              Are you sure you want to delete {displayText}?
            </ModalBody>
            <ModalFooter>
              <Button isDisabled={isLoading} variant="light" onPress={onClose}>
                Cancel
              </Button>
              <Button
                color="danger"
                isLoading={isLoading}
                spinner={<Spinner color="white" size="sm" variant="dots" />}
                spinnerPlacement="end"
                onPress={onDeleteAction}
              >
                {isLoading ? "Deleting" : "Delete"}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
