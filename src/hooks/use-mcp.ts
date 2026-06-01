// Copyright Amazon.com, Inc. or its affiliates.
"use client";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { Tool, UseMcpResult } from "use-mcp/react";
import { useMcp } from "use-mcp/react";

import { useLocalMcpServer } from "@/hooks/use-local-mcp-server";
import {
  cleanupMcpAuthInterceptor,
  initMcpAuthInterceptor,
  updateMcpServerUrls
} from "@/utils/mcp-auth-interceptor";

export type McpAuthMode = "none" | "session" | "custom";

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  description?: string;
  enabled: boolean;
  connectionStatus: "active" | "failed" | "connecting";
  autoApprovedTools: string[];
  disabledTools: string[];
  /** How outbound requests to this server should be authenticated. Treat missing as "none". */
  authMode?: McpAuthMode;
  liveConnectionState?: string;
  toolCount?: number;
}

export interface McpPreferences {
  enabledServers: McpServerConfig[];
  overrideAllApprovals: boolean;
}

// Individual MCP Connection Component - Exact copy of LISA's pattern
export const McpConnection = ({
  server,
  onToolsChange,
  onConnectionChange
}: {
  server: McpServerConfig;
  onToolsChange: (tools: Tool[], clientName: string) => void;
  onConnectionChange: (connection: UseMcpResult, clientName: string) => void;
}) => {
  // Use standard configuration - auth handled by fetch interceptor
  const connection = useMcp({
    url: server?.url ?? " ",
    clientName: server?.name,
    autoReconnect: true,
    autoRetry: true,
    debug: true,
    transportType: "auto"
  });

  // Use refs to track previous values and avoid unnecessary updates
  const prevToolsRef = useRef<string>("");
  const prevCallToolRef = useRef<UseMcpResult["callTool"] | null>(null);
  const prevStateRef = useRef<string>("");

  // Memoize tools to avoid unnecessary re-renders
  const toolsString = useMemo(
    () => JSON.stringify(connection.tools || []),
    [connection.tools]
  );

  useEffect(() => {
    if (prevToolsRef.current !== toolsString) {
      prevToolsRef.current = toolsString;
      onToolsChange(connection.tools || [], server.name);
    }
  }, [toolsString, server.name, onToolsChange, connection.tools]);

  useEffect(() => {
    if (
      connection.callTool &&
      prevCallToolRef.current !== connection.callTool
    ) {
      prevCallToolRef.current = connection.callTool;
      onConnectionChange(connection, server.name);
    }
  }, [connection.callTool, server.name, onConnectionChange, connection]);

  // Track state changes to notify of connection status updates (minimal logging)
  const connectionState = connection.state;
  useEffect(() => {
    if (prevStateRef.current !== connectionState) {
      prevStateRef.current = connectionState;
      onConnectionChange(connection, server.name);
    }
  }, [connectionState, server.name, onConnectionChange, connection]);

  return null; // This component only manages the connection
};

// Custom hook to manage multiple MCP connections - Architecturally improved
export const useMultipleMcp = (
  servers: McpServerConfig[],
  mcpPreferences: McpPreferences,
  dispatch?: React.Dispatch<unknown>,
  isAuthenticated: boolean = false
) => {
  // Import local MCP server hook
  const { executeLocalTool, isLocalTool, getLocalToolsForMcp } =
    useLocalMcpServer();

  // Use refs for internal state that doesn't need re-renders
  const serverToolsMapRef = useRef<Map<string, Tool[]>>(new Map());
  const connectionsMapRef = useRef<Map<string, UseMcpResult>>(new Map());
  const toolToServerMapRef = useRef<Map<string, string>>(new Map());
  const dispatchRef = useRef(dispatch); // Stable reference to dispatch

  // Keep dispatch ref up to date
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // Snapshot of the tool→server mapping returned to consumers. The internal
  // `toolToServerMapRef` is mutated in place by `handleToolsChange` for
  // cheap accumulation; after each mutation we publish a fresh snapshot
  // here so consumers see Map identity changes when contents change.
  const [toolToServerMapState, setToolToServerMapState] = useState<
    Map<string, string>
  >(new Map());

  // Only use useState for data that components need to re-render on
  const [allTools, setAllTools] = useState<Tool[]>([]);

  // Memoize enabled servers, filtering out local servers for external connections
  const enabledServers = useMemo(() => {
    return (
      servers?.filter(
        (server) =>
          server.enabled &&
          server.connectionStatus === "active" &&
          !server.url.startsWith("local://") // Exclude local servers from MCP connections
      ) || []
    );
  }, [servers]); // Only when actual server list changes

  // Create stable server list hash to prevent unnecessary recreation
  const serversHash = useMemo(() => {
    return enabledServers
      .map((s) => `${s.id}-${s.url}-${s.name}`)
      .sort()
      .join("|");
  }, [enabledServers]);

  // Captured once at mount; subsequent changes are handled by the
  // updateMcpServerUrls effect below.
  const [initialEnabledServers] = useState(() => enabledServers);

  useEffect(() => {
    if (initialEnabledServers.length > 0) {
      initMcpAuthInterceptor(initialEnabledServers);
    }
    return () => {
      cleanupMcpAuthInterceptor();
    };
  }, [initialEnabledServers]);

  useEffect(() => {
    if (enabledServers.length > 0) {
      updateMcpServerUrls(enabledServers);
    }
  }, [serversHash, enabledServers]);

  // Invoked from McpConnection children when a server's tools list
  // changes. Depends on `mcpPreferences` so preference changes
  // immediately re-filter the tool list.
  const handleToolsChange = useCallback(
    (tools: Tool[], clientName: string) => {
      const filteredTools = tools.filter(
        (tool) =>
          !mcpPreferences?.enabledServers
            ?.find((server) => server.name === clientName)
            ?.disabledTools.includes(tool.name)
      );

      // Update refs directly
      serverToolsMapRef.current.set(clientName, filteredTools);

      // Update tool-to-server mapping
      const toolToServerMap = toolToServerMapRef.current;

      // Remove old mappings for this server
      Array.from(toolToServerMap.entries()).forEach(
        ([toolName, serverName]) => {
          if (serverName === clientName) {
            toolToServerMap.delete(toolName);
          }
        }
      );
      // Add new mappings
      tools.forEach((tool) => {
        if (tool.name) {
          toolToServerMap.set(tool.name, clientName);
        }
      });

      // Update tool count in Redux for UI display (store in server object)
      // Only mark as "ready" when we actually have tools loaded
      if (
        dispatchRef.current &&
        typeof dispatchRef.current === "function" &&
        filteredTools.length > 0
      ) {
        const { updateServerLiveState } =
          require("@/store/slices/mcp-slice") as typeof import("@/store/slices/mcp-slice");

        dispatchRef.current(
          updateServerLiveState({
            serverName: clientName,
            connectionState: "ready",
            toolCount: filteredTools.length
          })
        );
      }

      // Trigger re-render with updated tools (aggregated from ALL servers + local tools)
      const externalTools = Array.from(
        serverToolsMapRef.current.values()
      ).flat();
      const localTools = getLocalToolsForMcp();
      const combinedTools = [...externalTools, ...(localTools as Tool[])];

      // Add local tools to the tool-to-server mapping
      localTools.forEach((tool) => {
        if (tool.name) {
          toolToServerMapRef.current.set(tool.name, "Local Viewport Server");
        }
      });

      setAllTools(combinedTools);
      setToolToServerMapState(new Map(toolToServerMapRef.current));
    },
    [mcpPreferences, getLocalToolsForMcp]
  );

  const handleConnectionChange = useCallback(
    (connection: UseMcpResult, clientName: string) => {
      connectionsMapRef.current.set(clientName, connection);
    },
    []
  );

  const callTool = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      let result: unknown;

      // Check if it's a local tool first
      if (isLocalTool(toolName)) {
        result = await executeLocalTool(toolName, args);
      } else {
        // Otherwise handle as external MCP server tool
        const serverName = toolToServerMapRef.current.get(toolName);

        if (!serverName) {
          throw new Error(`Tool "${toolName}" not found in any MCP server`);
        }

        const connection = connectionsMapRef.current.get(serverName);

        if (!connection || !connection.callTool) {
          throw new Error(
            `Connection for server "${serverName}" not available or doesn't support tool calling`
          );
        }

        result = await connection.callTool(toolName, args);
      }

      return result;
    },
    [isLocalTool, executeLocalTool]
  );

  // Create connections only when authenticated and server configuration changes
  const mcpConnections = useMemo(() => {
    if (isAuthenticated && enabledServers.length > 0) {
      return enabledServers.map((server) => {
        return React.createElement(McpConnection, {
          key: `${server.name}-${server.url}-${server.id}`, // Force recreation when URL changes
          server: server,
          onToolsChange: handleToolsChange,
          onConnectionChange: handleConnectionChange
        });
      });
    }

    return [];
  }, [
    isAuthenticated,
    enabledServers,
    handleToolsChange,
    handleConnectionChange
  ]); // Include authentication status

  return {
    tools: allTools,
    callTool,
    McpConnections: mcpConnections,
    toolToServerMap: toolToServerMapState
  };
};

// Hook for tool approval workflows
export const useToolApproval = (
  mcpPreferences: McpPreferences,
  toolToServerMap: Map<string, string>
) => {
  const [toolApprovalModal, setToolApprovalModal] = useState<{
    visible: boolean;
    tool: { name: string; args: Record<string, unknown> };
    resolve: (value: boolean) => void;
    reject: (error: Error) => void;
  } | null>(null);

  const checkAutoApproval = useCallback(
    (toolName: string): boolean => {
      if (mcpPreferences?.overrideAllApprovals) {
        return true;
      }

      const serverName = toolToServerMap.get(toolName);

      if (!serverName) return false;

      const server = mcpPreferences?.enabledServers.find(
        (s) => s.name === serverName
      );

      return server?.autoApprovedTools.includes(toolName) ?? false;
    },
    [mcpPreferences, toolToServerMap]
  );

  const requestToolApproval = useCallback(
    async (tool: {
      name: string;
      args: Record<string, unknown>;
    }): Promise<boolean> => {
      if (checkAutoApproval(tool.name)) {
        return Promise.resolve(true);
      }

      return new Promise((resolve, reject) => {
        setToolApprovalModal({
          visible: true,
          tool,
          resolve,
          reject
        });
      });
    },
    [checkAutoApproval]
  );

  const handleToolApproval = useCallback(() => {
    if (!toolApprovalModal) return;
    toolApprovalModal.resolve(true);
    setToolApprovalModal(null);
  }, [toolApprovalModal]);

  const handleToolRejection = useCallback(() => {
    if (!toolApprovalModal) return;
    toolApprovalModal.reject(new Error("Tool execution cancelled by user"));
    setToolApprovalModal(null);
  }, [toolApprovalModal]);

  return {
    toolApprovalModal,
    requestToolApproval,
    handleToolApproval,
    handleToolRejection,
    checkAutoApproval
  };
};
