// Copyright Amazon.com, Inc. or its affiliates.
import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";

import { bedrockQuotaService } from "../services/bedrock-service";
import { updateQuota } from "../store/slices/bedrock-quota-slice";
import { RootState } from "../store/store";

/**
 * Hook for fetching and updating quota usage information for specific models
 */
export function useQuotaUsage() {
  const dispatch = useDispatch();
  const selectedModel = useSelector(
    (state: RootState) => state.bedrockModel?.selectedModel
  );

  /**
   * Fetch quota usage for the currently selected model
   */
  const fetchQuotaUsage = useCallback(async () => {
    if (!selectedModel?.modelId) {
      return;
    }

    try {
      const response = await bedrockQuotaService.getModelQuota(
        selectedModel.modelId
      );

      dispatch(
        updateQuota({
          modelId: selectedModel.modelId,
          quotaInfo: response
        })
      );

      return response;
    } catch {
      // Don't throw error to prevent breaking polling
      // The UI will continue showing the last known quota state
    }
  }, [dispatch, selectedModel]);

  /**
   * Fetch quota usage for a specific model ID
   */
  const fetchQuotaForModel = useCallback(
    async (modelId: string) => {
      const response = await bedrockQuotaService.getModelQuota(modelId);

      dispatch(
        updateQuota({
          modelId,
          quotaInfo: response
        })
      );

      return response;
    },
    [dispatch]
  );

  return {
    fetchQuotaUsage,
    fetchQuotaForModel,
    currentModelId: selectedModel?.modelId || null
  };
}
