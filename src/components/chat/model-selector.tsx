// Copyright Amazon.com, Inc. or its affiliates.
"use client";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon
} from "@heroicons/react/24/outline";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { Select, SelectItem } from "@heroui/select";
import { Spinner } from "@heroui/spinner";
import type { SharedSelection } from "@heroui/system";
import { Tooltip } from "@heroui/tooltip";
import { useEffect } from "react";

import { BedrockModel, bedrockModelsService } from "@/services/bedrock-service";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAvailableModels,
  setSelectedModel
} from "@/store/slices/bedrock-model-slice";
import { setPreferredModel } from "@/store/slices/settings-slice";

interface ModelSelectorProps {
  isConnected: boolean;
  onModelChange?: (model: BedrockModel | null) => void;
  size?: "sm" | "md" | "lg";
  variant?: "flat" | "bordered" | "faded";
}

export const ModelSelector = ({
  isConnected,
  onModelChange,
  size = "sm",
  variant = "flat"
}: ModelSelectorProps) => {
  const dispatch = useAppDispatch();
  const { availableModels, selectedModel, isLoading, error } = useAppSelector(
    (state) => state.bedrockModel
  );

  // No automatic fetching - models are loaded at app level
  // The refresh button will trigger manual fetching when needed

  // Notify parent when selected model changes
  useEffect(() => {
    if (onModelChange) {
      onModelChange(selectedModel);
    }
  }, [selectedModel, onModelChange]);

  const handleSelectionChange = (keys: SharedSelection) => {
    const selectedKey =
      keys === "all" ? undefined : String(Array.from(keys)[0]);
    const model = selectedKey
      ? availableModels.find((m) => m.modelId === selectedKey) || null
      : null;

    dispatch(setSelectedModel(model));
    dispatch(
      setPreferredModel(
        model ? { modelId: model.modelId, modelName: model.modelName } : null
      )
    );
  };

  // Consistent layout with refresh button always on the right
  return (
    <div className="flex items-center justify-between gap-2 w-full">
      <div className="flex items-center gap-2 flex-1">
        {error && (
          <>
            <Tooltip content={`Error loading models: ${error}`}>
              <Chip
                className="cursor-help"
                color="danger"
                size={size}
                variant="flat"
              >
                Model Error
              </Chip>
            </Tooltip>
            <Chip
              className="cursor-pointer"
              color="primary"
              size={size}
              variant="bordered"
              onClick={() => dispatch(fetchAvailableModels())}
            >
              Retry
            </Chip>
          </>
        )}

        {isLoading && !error && (
          <>
            <Spinner color="primary" size="sm" variant="dots" />
            <span className="text-sm text-default-500">Loading models...</span>
          </>
        )}

        {!error && !isLoading && availableModels.length === 0 && (
          <Tooltip
            content={
              <div className="max-w-xs">
                <p className="mb-2">No models found.</p>
                <p className="mb-2">
                  Check your AWS Bedrock model access permissions.
                </p>
                <a
                  className="text-blue-400 hover:text-blue-300 underline flex items-center gap-1"
                  href="https://docs.aws.amazon.com/bedrock/latest/userguide/model-access-modify.html"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Learn how to enable model access
                  <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                </a>
              </div>
            }
            placement="bottom"
          >
            <Chip
              className="cursor-help"
              color="warning"
              size={size}
              variant="flat"
            >
              No Models Available
            </Chip>
          </Tooltip>
        )}

        {!error && !isLoading && availableModels.length > 0 && (
          <Select
            aria-label="Select AI Model"
            className="min-w-[200px] flex-1"
            classNames={{
              value: "text-default-700",
              trigger: isConnected
                ? "border-success-200 bg-success-50"
                : "border-default-200"
            }}
            placeholder="Select AI Model"
            selectedKeys={selectedModel ? [selectedModel.modelId] : []}
            size={size}
            variant={variant}
            onSelectionChange={handleSelectionChange}
          >
            {availableModels.map((model) => (
              <SelectItem
                key={model.modelId}
                textValue={bedrockModelsService.getModelDisplayName(model)}
              >
                <div className="flex items-center w-full">
                  <span className="font-medium">
                    {bedrockModelsService.getModelDisplayName(model)}
                  </span>
                </div>
              </SelectItem>
            ))}
          </Select>
        )}
      </div>

      {/* Always present refresh button on the right */}
      <Button
        isIconOnly
        aria-label="Refresh models"
        className="min-w-unit-8 w-unit-8 h-unit-8 flex-shrink-0"
        color="primary"
        isDisabled={isLoading}
        size="sm"
        variant="light"
        onPress={() => dispatch(fetchAvailableModels())}
      >
        <ArrowPathIcon className="h-4 w-4" />
      </Button>
    </div>
  );
};
