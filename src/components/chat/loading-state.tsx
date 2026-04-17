// Copyright Amazon.com, Inc. or its affiliates.
import { Spinner } from "@heroui/spinner";
import { useSelector } from "react-redux";

import {
  selectConnectedServersCount,
  selectEnabledServersCount,
  selectMcpInitialized
} from "@/store/slices/mcp-slice";
import { RootState } from "@/store/store";

export const LoadingState = () => {
  const { selectedModel, isLoading: modelsLoading } = useSelector(
    (state: RootState) => state.bedrockModel
  );
  const connectedServers = useSelector(selectConnectedServersCount);
  const enabledServers = useSelector(selectEnabledServersCount);
  const mcpInitialized = useSelector(selectMcpInitialized);

  // Determine loading states
  const isLoadingModels = !selectedModel || modelsLoading;
  const isLoadingMcpTools =
    selectedModel &&
    !modelsLoading &&
    (!mcpInitialized || connectedServers < enabledServers);
  const isSystemReady =
    selectedModel &&
    !modelsLoading &&
    mcpInitialized &&
    connectedServers >= enabledServers;

  if (!isLoadingModels && !isLoadingMcpTools && !isSystemReady) {
    return null; // System not initialized yet
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-4">
      {(isLoadingModels || isLoadingMcpTools) && (
        <>
          <Spinner size="sm" variant="dots" />
          <p className="text-sm text-default-500 mt-2 text-center">
            {isLoadingModels
              ? "Loading AI models..."
              : isLoadingMcpTools
                ? `Loading MCP tools... (${connectedServers} of ${enabledServers} servers)`
                : "Getting ready..."}
          </p>
        </>
      )}

      {!selectedModel && !modelsLoading && (
        <div className="text-sm text-center">
          <div className="space-y-2">
            <div>Please select an AI model from the sidebar</div>
            <div className="text-xs text-default-400">
              Go to Settings → AI Model to choose a model
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const useSystemReady = () => {
  const { selectedModel, isLoading: modelsLoading } = useSelector(
    (state: RootState) => state.bedrockModel
  );
  const connectedServers = useSelector(selectConnectedServersCount);
  const enabledServers = useSelector(selectEnabledServersCount);
  const mcpInitialized = useSelector(selectMcpInitialized);

  const isLoadingMcpTools =
    selectedModel &&
    !modelsLoading &&
    (!mcpInitialized || connectedServers < enabledServers);

  return {
    isSystemReady:
      selectedModel &&
      !modelsLoading &&
      mcpInitialized &&
      connectedServers >= enabledServers,
    isLoadingModels: !selectedModel || modelsLoading,
    isLoadingMcpTools,
    connectedServers,
    enabledServers
  };
};
