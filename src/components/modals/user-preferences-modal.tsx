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
import { Radio, RadioGroup } from "@heroui/radio";
import { Select, SelectItem } from "@heroui/select";
import { Spinner } from "@heroui/spinner";
import { Switch } from "@heroui/switch";
import type { SharedSelection } from "@heroui/system";
import { useTheme } from "next-themes";

import { DEFAULT_PREFERRED_MODEL } from "@/config/bedrock-defaults";
import { bedrockModelsService } from "@/services/bedrock-service";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectAutoZoom,
  selectPreferredModel,
  setAutoZoom,
  setPreferredModel
} from "@/store/slices/settings-slice";

interface UserPreferencesModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export const UserPreferencesModal = ({
  isOpen,
  onOpenChange
}: UserPreferencesModalProps) => {
  const dispatch = useAppDispatch();
  const { availableModels, isLoading } = useAppSelector(
    (state) => state.bedrockModel
  );
  const preferredModel = useAppSelector(selectPreferredModel);
  const autoZoom = useAppSelector(selectAutoZoom);
  const { theme, setTheme } = useTheme();

  const handleModelChange = (keys: SharedSelection) => {
    const selectedKey =
      keys === "all" ? undefined : String(Array.from(keys)[0]);
    if (!selectedKey) return;

    const model = availableModels.find((m) => m.modelId === selectedKey);
    if (model) {
      dispatch(
        setPreferredModel({
          modelId: model.modelId,
          modelName: model.modelName
        })
      );
    }
  };

  const handleAutoZoomChange = (value: boolean) => {
    dispatch(setAutoZoom(value));
  };

  const handleRestoreDefaults = () => {
    dispatch(setPreferredModel(DEFAULT_PREFERRED_MODEL));
    dispatch(setAutoZoom(true));
    setTheme("system");
  };

  const showLoading = isLoading && availableModels.length === 0;
  const showEmpty = !isLoading && availableModels.length === 0;

  return (
    <Modal isOpen={isOpen} size="md" onOpenChange={onOpenChange}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>User Preferences</ModalHeader>
            <ModalBody className="gap-6">
              <div className="flex flex-col gap-2">
                <label
                  className="text-sm font-medium text-default-700"
                  htmlFor="preferred-model-select"
                >
                  Preferred chat model
                </label>
                {showLoading ? (
                  <div className="flex items-center gap-2 py-2">
                    <Spinner color="primary" size="sm" variant="dots" />
                    <span className="text-sm text-default-500">
                      Loading models
                    </span>
                  </div>
                ) : showEmpty ? (
                  <Select
                    aria-label="Preferred chat model"
                    id="preferred-model-select"
                    isDisabled
                    placeholder="No models available"
                    size="sm"
                    variant="bordered"
                  >
                    {/* Empty children — disabled state */}
                    <></>
                  </Select>
                ) : (
                  <Select
                    aria-label="Preferred chat model"
                    id="preferred-model-select"
                    placeholder="Select a model"
                    selectedKeys={
                      preferredModel ? [preferredModel.modelId] : []
                    }
                    size="sm"
                    variant="bordered"
                    onSelectionChange={handleModelChange}
                  >
                    {availableModels.map((model) => (
                      <SelectItem
                        key={model.modelId}
                        textValue={bedrockModelsService.getModelDisplayName(
                          model
                        )}
                      >
                        {bedrockModelsService.getModelDisplayName(model)}
                      </SelectItem>
                    ))}
                  </Select>
                )}
                <span className="text-xs text-default-500">
                  Selected automatically on every page load.
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label
                    className="text-sm font-medium text-default-700"
                    htmlFor="auto-zoom-switch"
                  >
                    Auto-zoom on layer toggle
                  </label>
                  <Switch
                    id="auto-zoom-switch"
                    isSelected={autoZoom}
                    size="sm"
                    onValueChange={handleAutoZoomChange}
                  />
                </div>
                <span className="text-xs text-default-500">
                  When enabled, the map zooms to a layer when you make it
                  visible.
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <RadioGroup
                  classNames={{
                    label: "text-sm font-medium text-default-700"
                  }}
                  label="Color theme"
                  orientation="horizontal"
                  size="sm"
                  value={theme ?? "system"}
                  onValueChange={setTheme}
                >
                  <Radio value="light">Light</Radio>
                  <Radio value="dark">Dark</Radio>
                  <Radio value="system">System</Radio>
                </RadioGroup>
                <span className="text-xs text-default-500">
                  System follows your operating-system preference.
                </span>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                color="default"
                variant="light"
                onPress={handleRestoreDefaults}
              >
                Restore defaults
              </Button>
              <Button color="primary" onPress={onClose}>
                Close
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
