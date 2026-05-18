// Copyright Amazon.com, Inc. or its affiliates.
import { useCallback, useEffect, useMemo } from "react";

import { getLocalMcpServer } from "@/services/local-mcp-server";
import { useAppDispatch } from "@/store/hooks";
import { updateServerLiveState } from "@/store/slices/mcp-slice";
import { store } from "@/store/store";

export function useLocalMcpServer() {
  // Initialize local MCP server instance
  const localServer = useMemo(() => {
    return getLocalMcpServer(store);
  }, []);

  const dispatch = useAppDispatch();

  // Initialize and update Redux state
  useEffect(() => {
    // Update Redux state to show local server as ready
    dispatch(
      updateServerLiveState({
        serverName: "Local Viewport Server",
        connectionState: "ready",
        toolCount: localServer.getToolNames().length
      })
    );
  }, [localServer, dispatch]);

  const executeLocalTool = useCallback(
    async (
      toolName: string,
      args: Record<string, unknown>
    ): Promise<unknown> => {
      return await localServer.executeTool(toolName, args);
    },
    [localServer]
  );

  // Check if a tool is handled locally
  const isLocalTool = useCallback(
    (toolName: string): boolean => {
      return localServer.hasTool(toolName);
    },
    [localServer]
  );

  // Get tools in format compatible with existing MCP system
  const getLocalToolsForMcp = useCallback(() => {
    return localServer.getToolsForMcpIntegration();
  }, [localServer]);

  return {
    localServer,
    executeLocalTool,
    isLocalTool,
    getLocalToolsForMcp,
    localTools: localServer.getAvailableTools(),
    localToolNames: localServer.getToolNames(),
    toolCount: localServer.getToolNames().length
  };
}
