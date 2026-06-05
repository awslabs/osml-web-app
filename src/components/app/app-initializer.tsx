// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";

import { useMultipleMcp } from "@/hooks/use-mcp";
import { useSetMcpCallTool } from "@/hooks/use-mcp-runtime";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearModels,
  fetchAvailableModels
} from "@/store/slices/bedrock-model-slice";
import { fetchJobs } from "@/store/slices/jobs-slice";
import {
  initializeMcpConnections,
  selectMcpInitialized,
  selectMcpPreferences,
  selectMcpServers,
  setMcpRuntimeData
} from "@/store/slices/mcp-slice";

/**
 * Component to handle app-level initialization tasks like loading models
 * This ensures models are loaded once when the user is authenticated and persisted across navigation
 */
export const AppInitializer = () => {
  const dispatch = useAppDispatch();
  const { data: session, status } = useSession();
  const { lastFetched, selectedModel } = useAppSelector(
    (state) => state.bedrockModel
  );
  const mcpInitialized = useAppSelector(selectMcpInitialized);
  const mcpServers = useAppSelector(selectMcpServers);
  const mcpPreferences = useAppSelector(selectMcpPreferences);

  // Initialize MCP connections globally - only when authenticated to ensure token availability
  const mcpConnections = useMultipleMcp(
    mcpServers,
    mcpPreferences,
    dispatch,
    status === "authenticated"
  );

  // Bridge the live MCP runtime to the rest of the app. The serializable tool
  // catalog and tool→server map go into Redux; the non-serializable live
  // `callTool` function goes into the MCP runtime context.
  useSetMcpCallTool(mcpConnections.callTool);
  useEffect(() => {
    dispatch(
      setMcpRuntimeData({
        tools: mcpConnections.tools,
        toolToServerMap: Object.fromEntries(mcpConnections.toolToServerMap)
      })
    );
  }, [dispatch, mcpConnections.toolToServerMap, mcpConnections.tools]);

  useEffect(() => {
    if (status === "authenticated" && session?.accessToken && !lastFetched) {
      // User is authenticated and we haven't fetched models yet
      dispatch(fetchAvailableModels());
      // Also fetch jobs once at app level — shared state for map and globe
      dispatch(fetchJobs({}));
    } else if (status === "unauthenticated" && lastFetched) {
      // User logged out and we have cached models - clear them
      dispatch(clearModels());
    }
  }, [dispatch, session, status, lastFetched]);

  // Initialize MCP connections after models are loaded and default model selected
  useEffect(() => {
    if (selectedModel && !mcpInitialized && status === "authenticated") {
      // Models loaded and default model selected - now initialize MCP connections
      dispatch(initializeMcpConnections());
    }
  }, [dispatch, selectedModel, mcpInitialized, status]);

  // This component doesn't render anything visible but establishes MCP connections
  return <div style={{ display: "none" }}>{mcpConnections.McpConnections}</div>;
};
