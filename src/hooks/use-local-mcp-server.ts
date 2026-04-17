// Copyright Amazon.com, Inc. or its affiliates.
import { useEffect, useMemo } from "react";

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

  // Function to execute local tools
  const executeLocalTool = async (
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> => {
    return await localServer.executeTool(toolName, args);
  };

  // Check if a tool is handled locally
  const isLocalTool = (toolName: string): boolean => {
    return localServer.hasTool(toolName);
  };

  // Get tools in format compatible with existing MCP system
  const getLocalToolsForMcp = () => {
    return localServer.getToolsForMcpIntegration();
  };

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
