// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/modal";
import { Select, SelectItem } from "@heroui/select";
import { useState } from "react";

import { S3Selector } from "@/components/common/s3-selector.tsx";
import {
  DEFAULT_RANGE_ADJUSTMENT,
  DEFAULT_TILE_SIZE
} from "@/config/tile-server-defaults";
import { CreateViewpointForm } from "@/types/viewpoint";

interface CreateViewpointModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitAction: (data: CreateViewpointForm) => void;
}

export const CreateViewpointModal = ({
  isOpen,
  onOpenChange,
  onSubmitAction
}: CreateViewpointModalProps) => {
  const [formData, setFormData] = useState<CreateViewpointForm>({
    viewpointName: "",
    viewpointId: "",
    bucketName: "",
    objectKey: "",
    tileSize: DEFAULT_TILE_SIZE,
    rangeAdjustment: DEFAULT_RANGE_ADJUSTMENT
  });

  const handleSubmit = () => {
    onSubmitAction(formData);
    onOpenChange(false);
  };

  return (
    <Modal
      hideCloseButton
      isDismissable={false}
      isOpen={isOpen}
      size="2xl"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>Create New Viewpoint</ModalHeader>
            <ModalBody className="gap-4">
              <Input
                isRequired
                errorMessage={
                  !formData.viewpointName && "Viewpoint Name is required"
                }
                label="Viewpoint Name"
                value={formData.viewpointName}
                onValueChange={(value) =>
                  setFormData({ ...formData, viewpointName: value })
                }
              />

              <Input
                isRequired
                errorMessage={
                  !formData.viewpointId && "Viewpoint ID is required"
                }
                label="Viewpoint ID"
                value={formData.viewpointId}
                onValueChange={(value) =>
                  setFormData({ ...formData, viewpointId: value })
                }
              />

              <S3Selector
                selectedBucket={formData.bucketName}
                selectedObject={formData.objectKey}
                onBucketChange={(value: string) =>
                  setFormData({
                    ...formData,
                    bucketName: value,
                    objectKey: ""
                  })
                }
                onObjectChange={(value: string) =>
                  setFormData({ ...formData, objectKey: value })
                }
              />

              <Input
                isRequired
                errorMessage={
                  (!formData.tileSize || formData.tileSize < 1) &&
                  "Tile Size must be greater than 0"
                }
                label="Tile Size (px)"
                type="number"
                value={formData.tileSize.toString()}
                onValueChange={(value) =>
                  setFormData({ ...formData, tileSize: parseInt(value) || 0 })
                }
              />

              <Select
                isRequired
                defaultSelectedKeys={["NONE"]}
                label="Range Adjustment"
                selectedKeys={[formData.rangeAdjustment]}
                onSelectionChange={(keys) => {
                  if (keys instanceof Set && keys.size > 0) {
                    setFormData({
                      ...formData,
                      rangeAdjustment: Array.from(keys)[0] as
                        | "NONE"
                        | "MINMAX"
                        | "DRA"
                    });
                  }
                }}
              >
                <SelectItem key="NONE">None</SelectItem>
                <SelectItem key="MINMAX">MinMax</SelectItem>
                <SelectItem key="DRA">Dynamic</SelectItem>
              </Select>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                Cancel
              </Button>
              <Button
                color="primary"
                isDisabled={
                  !formData.viewpointName ||
                  !formData.viewpointId ||
                  !formData.bucketName ||
                  !formData.objectKey ||
                  !formData.tileSize ||
                  formData.tileSize < 1
                }
                onPress={handleSubmit}
              >
                Create
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
