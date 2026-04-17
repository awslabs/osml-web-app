// Copyright Amazon.com, Inc. or its affiliates.
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { Tool } from "use-mcp/react";

import { siteConfig } from "@/config/site";
import { McpPreferences, McpServerConfig } from "@/hooks/use-mcp";

interface McpState {
  servers: McpServerConfig[];
  preferences: McpPreferences;
  isLoading: boolean;
  error: string | null;
  initialized: boolean;
  connectionCount: number;
  toolApprovalModal: {
    isOpen: boolean;
    requestId: string | null;
    tool: {
      name: string;
      args: Record<string, unknown>;
    } | null;
  };
  isProcessingToolChain: boolean;
}

// Default MCP preferences
const defaultPreferences: McpPreferences = {
  enabledServers: [],
  overrideAllApprovals: false
};

// Default MCP server configurations
const defaultServers: McpServerConfig[] = [
  // Conditionally include OSML geo agent MCP server if URL is configured
  ...(siteConfig.mcp.geo_agents_url
    ? [
        {
          id: "osml-geo-agents",
          name: "OSML Geo Agent",
          url: siteConfig.mcp.geo_agents_url,
          description:
            "OSML geospatial analysis tools including buffering, clustering, and spatial operations",
          enabled: true,
          connectionStatus: "active" as const,
          autoApprovedTools: [] as string[],
          disabledTools: [] as string[]
        }
      ]
    : []),
  // Conditionally include STAC Loader MCP server if URL is configured
  ...(siteConfig.stac_loader_mcp_url
    ? [
        {
          id: "stac-loader",
          name: "STAC Data Loader",
          url: siteConfig.stac_loader_mcp_url,
          description: "Load STAC items from URL references into the workspace",
          enabled: true,
          connectionStatus: "active" as const,
          autoApprovedTools: [] as string[],
          disabledTools: [] as string[]
        }
      ]
    : []),
  {
    id: "local-viewport-server",
    name: "Local Viewport Server",
    url: "local://viewport",
    description: "Local tools for viewport and map interaction",
    enabled: true,
    connectionStatus: "active",
    autoApprovedTools: ["get_viewport"],
    disabledTools: []
  }
];

const initialState: McpState = {
  servers: defaultServers,
  preferences: {
    ...defaultPreferences,
    enabledServers: defaultServers.filter((s) => s.enabled)
  },
  isLoading: false,
  error: null,
  initialized: false,
  connectionCount: 0,
  toolApprovalModal: {
    isOpen: false,
    requestId: null,
    tool: null
  },
  isProcessingToolChain: false
};

// Initialize MCP connections
export const initializeMcpConnections = createAsyncThunk(
  "mcp/initializeMcpConnections",
  (_, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { mcp: McpState };
      const activeServers = state.mcp.servers.filter(
        (s) => s.enabled && s.connectionStatus === "active"
      );

      // Return server info for connection initialization
      return {
        serverCount: activeServers.length,
        servers: activeServers.map((s) => ({
          id: s.id,
          name: s.name,
          url: s.url
        }))
      };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error
          ? error.message
          : "Failed to initialize MCP connections"
      );
    }
  }
);

const mcpSlice = createSlice({
  name: "mcp",
  initialState,
  reducers: {
    // Server management actions
    addServer: (state, action: PayloadAction<McpServerConfig>) => {
      state.servers.push(action.payload);
      if (action.payload.enabled) {
        state.preferences.enabledServers.push(action.payload);
      }
    },

    updateServer: (state, action: PayloadAction<McpServerConfig>) => {
      const index = state.servers.findIndex((s) => s.id === action.payload.id);

      if (index !== -1) {
        const oldServer = state.servers[index];
        const newServerData = action.payload;

        // If URL or critical connection settings changed, reset connection status to allow reconnection
        const shouldReconnect =
          oldServer.url !== newServerData.url ||
          oldServer.enabled !== newServerData.enabled ||
          oldServer.connectionStatus === "failed";

        // Create the updated server object with proper connection status
        const updatedServer = {
          ...newServerData,
          connectionStatus:
            shouldReconnect && newServerData.enabled
              ? ("active" as const)
              : newServerData.connectionStatus
        };

        state.servers[index] = updatedServer;

        // Update in preferences if it exists there
        const prefIndex = state.preferences.enabledServers.findIndex(
          (s) => s.id === action.payload.id
        );

        if (prefIndex !== -1) {
          state.preferences.enabledServers[prefIndex] = updatedServer;
        }
      }
    },

    removeServer: (state, action: PayloadAction<string>) => {
      state.servers = state.servers.filter((s) => s.id !== action.payload);
      state.preferences.enabledServers =
        state.preferences.enabledServers.filter((s) => s.id !== action.payload);
    },

    toggleServer: (
      state,
      action: PayloadAction<{ serverId: string; enabled: boolean }>
    ) => {
      const { serverId, enabled } = action.payload;
      const server = state.servers.find((s) => s.id === serverId);

      if (server) {
        server.enabled = enabled;

        if (enabled) {
          // Add to enabled servers if not already there
          if (
            !state.preferences.enabledServers.find((s) => s.id === serverId)
          ) {
            state.preferences.enabledServers.push(server);
          }
        } else {
          // Remove from enabled servers
          state.preferences.enabledServers =
            state.preferences.enabledServers.filter((s) => s.id !== serverId);
        }
      }
    },

    // Preferences management
    updatePreferences: (state, action: PayloadAction<McpPreferences>) => {
      state.preferences = action.payload;
    },

    toggleOverrideAllApprovals: (state) => {
      state.preferences.overrideAllApprovals =
        !state.preferences.overrideAllApprovals;
    },

    toggleToolAutoApproval: (
      state,
      action: PayloadAction<{ serverId: string; toolName: string }>
    ) => {
      const { serverId, toolName } = action.payload;
      const server = state.preferences.enabledServers.find(
        (s) => s.id === serverId
      );

      if (server) {
        if (server.autoApprovedTools.includes(toolName)) {
          server.autoApprovedTools = server.autoApprovedTools.filter(
            (t) => t !== toolName
          );
        } else {
          server.autoApprovedTools.push(toolName);
        }
      }
    },

    toggleToolDisabled: (
      state,
      action: PayloadAction<{
        serverId: string;
        toolName: string;
        disabled: boolean;
      }>
    ) => {
      const { serverId, toolName, disabled } = action.payload;
      const server = state.servers.find((s) => s.id === serverId);
      const prefServer = state.preferences.enabledServers.find(
        (s) => s.id === serverId
      );

      if (server) {
        if (disabled) {
          if (!server.disabledTools.includes(toolName)) {
            server.disabledTools.push(toolName);
          }
        } else {
          server.disabledTools = server.disabledTools.filter(
            (t) => t !== toolName
          );
        }
      }

      if (prefServer) {
        if (disabled) {
          if (!prefServer.disabledTools.includes(toolName)) {
            prefServer.disabledTools.push(toolName);
          }
        } else {
          prefServer.disabledTools = prefServer.disabledTools.filter(
            (t) => t !== toolName
          );
        }
      }
    },

    // Reset to defaults
    resetToDefaults: (state) => {
      state.servers = defaultServers;
      state.preferences = {
        ...defaultPreferences,
        enabledServers: defaultServers.filter((s) => s.enabled)
      };
    },

    // Load state from localStorage
    loadFromStorage: (
      state,
      action: PayloadAction<{
        servers?: McpServerConfig[];
        preferences?: McpPreferences;
      }>
    ) => {
      if (action.payload.servers) {
        state.servers = action.payload.servers;
      }
      if (action.payload.preferences) {
        state.preferences = action.payload.preferences;
      }
    },

    // Loading and error states
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },

    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },

    // Connection status management
    updateServerConnectionStatus: (
      state,
      action: PayloadAction<{
        serverId: string;
        status: "active" | "failed" | "connecting";
      }>
    ) => {
      const { serverId, status } = action.payload;
      const server = state.servers.find((s) => s.id === serverId);
      const prefServer = state.preferences.enabledServers.find(
        (s) => s.id === serverId
      );

      if (server) {
        server.connectionStatus = status;
      }

      if (prefServer) {
        prefServer.connectionStatus = status;
      }
    },

    markServerAsFailed: (state, action: PayloadAction<string>) => {
      const serverId = action.payload;
      const server = state.servers.find((s) => s.id === serverId);
      const prefServer = state.preferences.enabledServers.find(
        (s) => s.id === serverId
      );

      if (server) {
        server.connectionStatus = "failed";
      }

      if (prefServer) {
        prefServer.connectionStatus = "failed";
      }
    },

    resetServerConnectionStatus: (state, action: PayloadAction<string>) => {
      const serverId = action.payload;
      const server = state.servers.find((s) => s.id === serverId);
      const prefServer = state.preferences.enabledServers.find(
        (s) => s.id === serverId
      );

      if (server) {
        server.connectionStatus = "active";
      }

      if (prefServer) {
        prefServer.connectionStatus = "active";
      }
    },

    // Live connection state and tool count management (stored in server objects)
    updateServerLiveState: (
      state,
      action: PayloadAction<{
        serverName: string;
        connectionState: string;
        toolCount?: number;
      }>
    ) => {
      const { serverName, connectionState, toolCount } = action.payload;

      // Update main servers list
      const server = state.servers.find((s) => s.name === serverName);

      if (server) {
        server.liveConnectionState = connectionState;
        if (toolCount !== undefined) {
          server.toolCount = toolCount;
        }
      }

      // Update preferences enabled servers list
      const prefServer = state.preferences.enabledServers.find(
        (s) => s.name === serverName
      );

      if (prefServer) {
        prefServer.liveConnectionState = connectionState;
        if (toolCount !== undefined) {
          prefServer.toolCount = toolCount;
        }
      }
    },

    clearServerLiveState: (state, action: PayloadAction<string>) => {
      const serverName = action.payload;

      // Clear from main servers list
      const server = state.servers.find((s) => s.name === serverName);

      if (server) {
        server.liveConnectionState = undefined;
        server.toolCount = 0;
      }

      // Clear from preferences enabled servers list
      const prefServer = state.preferences.enabledServers.find(
        (s) => s.name === serverName
      );

      if (prefServer) {
        prefServer.liveConnectionState = undefined;
        prefServer.toolCount = 0;
      }
    },

    // Tool Approval Modal management
    showToolApprovalModal: (
      state,
      action: PayloadAction<{
        requestId: string;
        tool: { name: string; args: Record<string, unknown> };
      }>
    ) => {
      state.toolApprovalModal = {
        isOpen: true,
        requestId: action.payload.requestId,
        tool: action.payload.tool
      };
    },

    closeToolApprovalModal: (state) => {
      state.toolApprovalModal = {
        isOpen: false,
        requestId: null,
        tool: null
      };
    },

    // Tool Chain Processing State
    setProcessingToolChain: (state, action: PayloadAction<boolean>) => {
      state.isProcessingToolChain = action.payload;
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeMcpConnections.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(initializeMcpConnections.fulfilled, (state, action) => {
        state.isLoading = false;
        state.initialized = true;
        state.connectionCount = action.payload.serverCount;
        state.error = null;
      })
      .addCase(initializeMcpConnections.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });
  }
});

export const {
  addServer,
  updateServer,
  removeServer,
  toggleServer,
  updatePreferences,
  toggleOverrideAllApprovals,
  toggleToolAutoApproval,
  toggleToolDisabled,
  resetToDefaults,
  loadFromStorage,
  setLoading,
  setError,
  updateServerConnectionStatus,
  markServerAsFailed,
  resetServerConnectionStatus,
  updateServerLiveState,
  clearServerLiveState,
  showToolApprovalModal,
  closeToolApprovalModal,
  setProcessingToolChain
} = mcpSlice.actions;

export default mcpSlice.reducer;

// Selectors
export const selectMcpServers = (state: { mcp: McpState }) => state.mcp.servers;
export const selectMcpPreferences = (state: { mcp: McpState }) =>
  state.mcp.preferences;
export const selectEnabledMcpServers = (state: { mcp: McpState }) =>
  state.mcp.servers.filter((server) => server.enabled);
export const selectMcpIsLoading = (state: { mcp: McpState }) =>
  state.mcp.isLoading;
export const selectMcpError = (state: { mcp: McpState }) => state.mcp.error;
export const selectMcpInitialized = (state: { mcp: McpState }) =>
  state.mcp.initialized;
export const selectMcpConnectionCount = (state: { mcp: McpState }) =>
  state.mcp.connectionCount;
export const selectToolApprovalModal = (state: { mcp: McpState }) =>
  state.mcp.toolApprovalModal;
export const selectIsProcessingToolChain = (state: { mcp: McpState }) =>
  state.mcp.isProcessingToolChain;

// Global MCP utilities storage
interface McpGlobals {
  callTool:
    | ((toolName: string, args: Record<string, unknown>) => Promise<unknown>)
    | null;
  toolToServerMap: Map<string, string>;
  tools: Tool[];
}

const mcpGlobals: McpGlobals = {
  callTool: null,
  toolToServerMap: new Map(),
  tools: []
};

// Computed selectors that aggregate data from server objects
export const selectTotalToolCount = (state: { mcp: McpState }) =>
  state.mcp.servers
    .filter(
      (server) => server.enabled && server.liveConnectionState === "ready"
    )
    .reduce((sum, server) => sum + (server.toolCount || 0), 0);

export const selectConnectedServersCount = (state: { mcp: McpState }) =>
  state.mcp.servers.filter(
    (server) => server.enabled && server.liveConnectionState === "ready"
  ).length;

export const selectEnabledServersCount = (state: { mcp: McpState }) =>
  state.mcp.servers.filter((server) => server.enabled).length;

// Global MCP selectors
export const selectMcpCallTool = () => mcpGlobals.callTool;
export const selectMcpToolToServerMap = () => mcpGlobals.toolToServerMap;
export const selectMcpTools = () => mcpGlobals.tools;

// Export globals for direct access
export { mcpGlobals };
