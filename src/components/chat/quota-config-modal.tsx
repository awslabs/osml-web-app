// Copyright Amazon.com, Inc. or its affiliates.
"use client";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Input } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/modal";
import { useState } from "react";
import { useSelector } from "react-redux";

import { selectAllQuotas } from "@/store/slices/bedrock-quota-slice";
import { RootState } from "@/store/store";

interface QuotaConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QuotaConfigModal = ({
  isOpen,
  onClose
}: QuotaConfigModalProps) => {
  const quotas = useSelector(selectAllQuotas);
  const { availableModels, selectedModel } = useSelector(
    (state: RootState) => state.bedrockModel
  );

  const [editMode] = useState(false); // For future: allow editing

  const formatNumber = (num: number): string => {
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}k`;
    }

    return num.toString();
  };

  return (
    <Modal isOpen={isOpen} scrollBehavior="inside" size="2xl" onClose={onClose}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex items-center gap-2">
              <ChartBarIcon className="w-5 h-5" />
              <span>Quota Configuration</span>
            </ModalHeader>
            <ModalBody>
              <div className="space-y-4">
                {/* Current Model Info */}
                {selectedModel && (
                  <div className="text-sm">
                    <span className="text-default-500">Current Model: </span>
                    <span className="font-medium">
                      {selectedModel.modelName}
                    </span>
                  </div>
                )}

                {/* Quota List */}
                <div className="space-y-3">
                  {quotas.length === 0 ? (
                    <Card>
                      <CardBody className="text-center text-default-400 py-8">
                        <p>No quota information available yet.</p>
                        <p className="text-xs mt-2">
                          Quota data will appear after sending messages.
                        </p>
                      </CardBody>
                    </Card>
                  ) : (
                    quotas.map((quota) => {
                      const model = availableModels.find(
                        (m) => m.modelId === quota.model_id
                      );
                      const isCurrentModel =
                        selectedModel?.modelId === quota.model_id;

                      return (
                        <Card
                          key={quota.model_id}
                          className={
                            isCurrentModel ? "border-2 border-primary" : ""
                          }
                        >
                          <CardBody>
                            <div className="space-y-3">
                              {/* Model Name */}
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium">
                                    {model?.modelName || quota.model_id}
                                  </div>
                                  <div className="text-xs text-default-400">
                                    {quota.model_id}
                                  </div>
                                </div>
                                {isCurrentModel && (
                                  <span className="text-xs text-primary bg-primary-50 px-2 py-1 rounded">
                                    Active
                                  </span>
                                )}
                              </div>

                              {/* Limits */}
                              {quota.limits && (
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  <div className="space-y-1">
                                    <div className="text-default-500 text-xs">
                                      Requests per Minute
                                    </div>
                                    {editMode ? (
                                      <Input
                                        isDisabled
                                        size="sm"
                                        type="number"
                                        value={quota.limits.requests_per_minute.toString()}
                                      />
                                    ) : (
                                      <div className="font-medium tabular-nums">
                                        {quota.limits.requests_per_minute}
                                      </div>
                                    )}
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-default-500 text-xs">
                                      Tokens per Minute
                                    </div>
                                    {editMode ? (
                                      <Input
                                        isDisabled
                                        size="sm"
                                        type="number"
                                        value={quota.limits.tokens_per_minute.toString()}
                                      />
                                    ) : (
                                      <div className="font-medium tabular-nums">
                                        {formatNumber(
                                          quota.limits.tokens_per_minute
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Current Usage */}
                              {quota.usage && (
                                <div className="pt-2 border-t border-default-200">
                                  <div className="text-xs text-default-500 mb-2">
                                    Current Usage
                                  </div>
                                  <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                      <span className="text-default-500">
                                        Requests:
                                      </span>{" "}
                                      <span className="font-medium tabular-nums">
                                        {quota.usage.requests_used}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-default-500">
                                        Tokens:
                                      </span>{" "}
                                      <span className="font-medium tabular-nums">
                                        {formatNumber(quota.usage.tokens_used)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Usage Percentage */}
                              {quota.usage_percent && (
                                <div className="pt-2 border-t border-default-200">
                                  <div className="text-xs text-default-500 mb-2">
                                    Usage Percentage
                                  </div>
                                  <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                      <span className="text-default-500">
                                        Requests:
                                      </span>{" "}
                                      <span className="font-medium tabular-nums">
                                        {quota.usage_percent.requests.toFixed(
                                          1
                                        )}
                                        %
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-default-500">
                                        Tokens:
                                      </span>{" "}
                                      <span className="font-medium tabular-nums">
                                        {quota.usage_percent.tokens.toFixed(1)}%
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </CardBody>
                        </Card>
                      );
                    })
                  )}
                </div>

                {/* Help section */}
                <Card className="bg-default-50">
                  <CardBody className="text-xs text-default-500">
                    <p className="font-medium mb-1">💡 Quota Management</p>
                    <p className="text-[10px] text-default-400">
                      Limits are automatically retrieved from your AWS Service
                      Quotas. To increase limits, request a quota increase in
                      AWS Console → Service Quotas → Amazon Bedrock.
                    </p>
                  </CardBody>
                </Card>
              </div>
            </ModalBody>
            <ModalFooter>
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
