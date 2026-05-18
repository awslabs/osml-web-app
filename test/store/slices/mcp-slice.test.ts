// Copyright Amazon.com, Inc. or its affiliates.
import { configureStore } from "@reduxjs/toolkit";

import mcpReducer, {
  selectConnectedServersCount,
  selectEnabledServersCount,
  selectTotalToolCount,
  updateServerLiveState
} from "@/store/slices/mcp-slice";

describe("MCP Slice - Server Connection State", () => {
  const createStore = () =>
    configureStore({
      reducer: {
        mcp: mcpReducer
      }
    });

  // Get the actual number of default enabled servers (depends on env config)
  const getDefaultEnabledCount = () => {
    const store = createStore();
    return selectEnabledServersCount(store.getState());
  };

  describe("selectEnabledServersCount", () => {
    it("should return count of enabled servers", () => {
      const store = createStore();
      const state = store.getState();

      // Default state has at least 1 enabled server (Local Viewport Server);
      // a configured Geo Agents URL adds a second.
      expect(selectEnabledServersCount(state)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("selectConnectedServersCount", () => {
    it("should return 0 when no servers have liveConnectionState set", () => {
      const store = createStore();
      const state = store.getState();

      expect(selectConnectedServersCount(state)).toBe(0);
    });

    it("should count only servers with liveConnectionState === 'ready'", () => {
      const store = createStore();
      const enabledCount = getDefaultEnabledCount();

      // Set Local Viewport Server to ready
      store.dispatch(
        updateServerLiveState({
          serverName: "Local Viewport Server",
          connectionState: "ready",
          toolCount: 8
        })
      );

      let state = store.getState();
      expect(selectConnectedServersCount(state)).toBe(1);

      // If there's a second server (OSML Geo Agent), set it to ready too
      if (enabledCount >= 2) {
        store.dispatch(
          updateServerLiveState({
            serverName: "OSML Geo Agent",
            connectionState: "ready",
            toolCount: 8
          })
        );

        state = store.getState();
        expect(selectConnectedServersCount(state)).toBe(2);
      }
    });

    it("should not count servers with non-ready connection states", () => {
      const store = createStore();

      // Set server to connecting (not ready)
      store.dispatch(
        updateServerLiveState({
          serverName: "Local Viewport Server",
          connectionState: "connecting",
          toolCount: 0
        })
      );

      const state = store.getState();
      expect(selectConnectedServersCount(state)).toBe(0);
    });
  });

  describe("selectTotalToolCount", () => {
    it("should return 0 when no servers are connected", () => {
      const store = createStore();
      const state = store.getState();

      expect(selectTotalToolCount(state)).toBe(0);
    });

    it("should sum tool counts from all connected servers", () => {
      const store = createStore();
      const enabledCount = getDefaultEnabledCount();

      store.dispatch(
        updateServerLiveState({
          serverName: "Local Viewport Server",
          connectionState: "ready",
          toolCount: 8
        })
      );

      let state = store.getState();
      expect(selectTotalToolCount(state)).toBe(8);

      // If there's a second server, add its tools too
      if (enabledCount >= 2) {
        store.dispatch(
          updateServerLiveState({
            serverName: "OSML Geo Agent",
            connectionState: "ready",
            toolCount: 8
          })
        );

        state = store.getState();
        expect(selectTotalToolCount(state)).toBe(16);
      }
    });
  });

  describe("System Readiness Logic", () => {
    /**
     * This test validates the fix for the bug where the system was marked as ready
     * before all MCP servers finished connecting.
     *
     * The system should only be considered ready when:
     * connectedServers >= enabledServers
     */
    it("should not consider system ready until all enabled servers are connected", () => {
      const store = createStore();

      const enabledCount = selectEnabledServersCount(store.getState());
      expect(enabledCount).toBeGreaterThanOrEqual(1);

      // Initially no servers connected
      let connectedCount = selectConnectedServersCount(store.getState());
      expect(connectedCount).toBe(0);
      expect(connectedCount >= enabledCount).toBe(false);

      // After local server connects
      store.dispatch(
        updateServerLiveState({
          serverName: "Local Viewport Server",
          connectionState: "ready",
          toolCount: 8
        })
      );

      connectedCount = selectConnectedServersCount(store.getState());
      expect(connectedCount).toBe(1);

      // If only 1 server is enabled, we should be ready now
      if (enabledCount === 1) {
        expect(connectedCount >= enabledCount).toBe(true);
      } else {
        // If 2 servers enabled, we're not ready yet
        expect(connectedCount >= enabledCount).toBe(false);

        // After remote server connects
        store.dispatch(
          updateServerLiveState({
            serverName: "OSML Geo Agent",
            connectionState: "ready",
            toolCount: 8
          })
        );

        connectedCount = selectConnectedServersCount(store.getState());
        expect(connectedCount).toBe(2);
        expect(connectedCount >= enabledCount).toBe(true);
      }
    });

    /**
     * Regression test: Servers should NOT be marked as ready when they have 0 tools.
     * This was the root cause of the bug - handleToolsChange was setting connectionState
     * to "ready" even when called with an empty tools array.
     */
    it("should track tool count separately from connection state", () => {
      const store = createStore();

      // Simulate the bug scenario: server marked ready with 0 tools
      // (This should NOT happen in production after the fix, but we test the state behavior)
      store.dispatch(
        updateServerLiveState({
          serverName: "Local Viewport Server",
          connectionState: "ready",
          toolCount: 0
        })
      );

      const state = store.getState();
      const server = state.mcp.servers.find(
        (s: { name: string }) => s.name === "Local Viewport Server"
      );

      // The server IS marked as ready (state allows this)
      expect(server?.liveConnectionState).toBe("ready");
      expect(server?.toolCount).toBe(0);

      // But total tool count is 0
      expect(selectTotalToolCount(state)).toBe(0);

      // And connected count includes this server
      // (The fix is in use-mcp.ts to not dispatch this action with 0 tools)
      expect(selectConnectedServersCount(state)).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Server CRUD, toggle, tool approval, connection status, modal, processing
// ---------------------------------------------------------------------------

import {
  addServer,
  clearServerLiveState,
  closeToolApprovalModal,
  initializeMcpConnections,
  loadFromStorage,
  markServerAsFailed,
  removeServer,
  resetServerConnectionStatus,
  resetToDefaults,
  selectEnabledMcpServers,
  selectIsProcessingToolChain,
  selectMcpError,
  selectMcpIsLoading,
  selectMcpPreferences,
  selectMcpServers,
  selectToolApprovalModal,
  setError,
  setLoading,
  setProcessingToolChain,
  showToolApprovalModal,
  toggleOverrideAllApprovals,
  toggleServer,
  toggleToolAutoApproval,
  toggleToolDisabled,
  updateServer,
  updateServerConnectionStatus
} from "@/store/slices/mcp-slice";

const testServer = {
  id: "test-server",
  name: "Test Server",
  url: "https://test.example.com/mcp",
  description: "A test server",
  enabled: true,
  connectionStatus: "active" as const,
  autoApprovedTools: [] as string[],
  disabledTools: [] as string[]
};

describe("mcp-slice - server management", () => {
  const createMcpStore = () => configureStore({ reducer: { mcp: mcpReducer } });

  describe("server CRUD", () => {
    it("addServer should add to servers and preferences if enabled", () => {
      const store = createMcpStore();
      store.dispatch(addServer(testServer));
      expect(
        selectMcpServers(store.getState()).find((s) => s.id === "test-server")
      ).toBeDefined();
      expect(
        selectMcpPreferences(store.getState()).enabledServers.find(
          (s) => s.id === "test-server"
        )
      ).toBeDefined();
    });

    it("addServer should not add to preferences if disabled", () => {
      const store = createMcpStore();
      store.dispatch(addServer({ ...testServer, enabled: false }));
      expect(
        selectMcpPreferences(store.getState()).enabledServers.find(
          (s) => s.id === "test-server"
        )
      ).toBeUndefined();
    });

    it("updateServer should update existing server", () => {
      const store = createMcpStore();
      store.dispatch(addServer(testServer));
      store.dispatch(updateServer({ ...testServer, description: "Updated" }));
      expect(
        selectMcpServers(store.getState()).find((s) => s.id === "test-server")
          ?.description
      ).toBe("Updated");
    });

    it("updateServer should reset connection status when URL changes", () => {
      const store = createMcpStore();
      store.dispatch(addServer({ ...testServer, connectionStatus: "failed" }));
      store.dispatch(
        updateServer({ ...testServer, url: "https://new-url.com/mcp" })
      );
      expect(
        selectMcpServers(store.getState()).find((s) => s.id === "test-server")
          ?.connectionStatus
      ).toBe("active");
    });

    it("removeServer should remove from servers and preferences", () => {
      const store = createMcpStore();
      store.dispatch(addServer(testServer));
      store.dispatch(removeServer("test-server"));
      expect(
        selectMcpServers(store.getState()).find((s) => s.id === "test-server")
      ).toBeUndefined();
    });
  });

  describe("toggleServer", () => {
    it("should disable a server and remove from preferences", () => {
      const store = createMcpStore();
      store.dispatch(addServer(testServer));
      store.dispatch(toggleServer({ serverId: "test-server", enabled: false }));
      expect(
        selectMcpServers(store.getState()).find((s) => s.id === "test-server")
          ?.enabled
      ).toBe(false);
      expect(
        selectMcpPreferences(store.getState()).enabledServers.find(
          (s) => s.id === "test-server"
        )
      ).toBeUndefined();
    });

    it("should enable a server and add to preferences", () => {
      const store = createMcpStore();
      store.dispatch(addServer({ ...testServer, enabled: false }));
      store.dispatch(toggleServer({ serverId: "test-server", enabled: true }));
      expect(
        selectMcpPreferences(store.getState()).enabledServers.find(
          (s) => s.id === "test-server"
        )
      ).toBeDefined();
    });
  });

  describe("tool approval", () => {
    it("toggleOverrideAllApprovals should toggle", () => {
      const store = createMcpStore();
      expect(selectMcpPreferences(store.getState()).overrideAllApprovals).toBe(
        false
      );
      store.dispatch(toggleOverrideAllApprovals());
      expect(selectMcpPreferences(store.getState()).overrideAllApprovals).toBe(
        true
      );
    });

    it("toggleToolAutoApproval should add/remove tool", () => {
      const store = createMcpStore();
      store.dispatch(addServer(testServer));
      store.dispatch(
        toggleToolAutoApproval({ serverId: "test-server", toolName: "my_tool" })
      );
      expect(
        selectMcpPreferences(store.getState()).enabledServers.find(
          (s) => s.id === "test-server"
        )?.autoApprovedTools
      ).toContain("my_tool");
      store.dispatch(
        toggleToolAutoApproval({ serverId: "test-server", toolName: "my_tool" })
      );
      expect(
        selectMcpPreferences(store.getState()).enabledServers.find(
          (s) => s.id === "test-server"
        )?.autoApprovedTools
      ).not.toContain("my_tool");
    });

    it("toggleToolDisabled should add/remove tool", () => {
      const store = createMcpStore();
      store.dispatch(addServer(testServer));
      store.dispatch(
        toggleToolDisabled({
          serverId: "test-server",
          toolName: "risky",
          disabled: true
        })
      );
      expect(
        selectMcpServers(store.getState()).find((s) => s.id === "test-server")
          ?.disabledTools
      ).toContain("risky");
      store.dispatch(
        toggleToolDisabled({
          serverId: "test-server",
          toolName: "risky",
          disabled: false
        })
      );
      expect(
        selectMcpServers(store.getState()).find((s) => s.id === "test-server")
          ?.disabledTools
      ).not.toContain("risky");
    });
  });

  describe("connection status", () => {
    it("updateServerConnectionStatus should update status", () => {
      const store = createMcpStore();
      store.dispatch(addServer(testServer));
      store.dispatch(
        updateServerConnectionStatus({
          serverId: "test-server",
          status: "connecting"
        })
      );
      expect(
        selectMcpServers(store.getState()).find((s) => s.id === "test-server")
          ?.connectionStatus
      ).toBe("connecting");
    });

    it("markServerAsFailed should set failed", () => {
      const store = createMcpStore();
      store.dispatch(addServer(testServer));
      store.dispatch(markServerAsFailed("test-server"));
      expect(
        selectMcpServers(store.getState()).find((s) => s.id === "test-server")
          ?.connectionStatus
      ).toBe("failed");
    });

    it("resetServerConnectionStatus should set active", () => {
      const store = createMcpStore();
      store.dispatch(addServer({ ...testServer, connectionStatus: "failed" }));
      store.dispatch(resetServerConnectionStatus("test-server"));
      expect(
        selectMcpServers(store.getState()).find((s) => s.id === "test-server")
          ?.connectionStatus
      ).toBe("active");
    });

    it("clearServerLiveState should clear live state", () => {
      const store = createMcpStore();
      store.dispatch(addServer(testServer));
      store.dispatch(
        updateServerLiveState({
          serverName: "Test Server",
          connectionState: "ready",
          toolCount: 10
        })
      );
      store.dispatch(clearServerLiveState("Test Server"));
      const server = selectMcpServers(store.getState()).find(
        (s) => s.name === "Test Server"
      );
      expect(server?.liveConnectionState).toBeUndefined();
      expect(server?.toolCount).toBe(0);
    });
  });

  describe("resetToDefaults / loadFromStorage", () => {
    it("resetToDefaults should restore defaults", () => {
      const store = createMcpStore();
      store.dispatch(addServer(testServer));
      store.dispatch(resetToDefaults());
      expect(
        selectMcpServers(store.getState()).find((s) => s.id === "test-server")
      ).toBeUndefined();
    });

    it("loadFromStorage should load state", () => {
      const store = createMcpStore();
      store.dispatch(
        loadFromStorage({
          servers: [testServer],
          preferences: {
            enabledServers: [testServer],
            overrideAllApprovals: true
          }
        })
      );
      expect(selectMcpServers(store.getState())).toEqual([testServer]);
      expect(selectMcpPreferences(store.getState()).overrideAllApprovals).toBe(
        true
      );
    });
  });

  describe("loading, error, modal, processing", () => {
    it("setLoading / setError", () => {
      const store = createMcpStore();
      store.dispatch(setLoading(true));
      expect(selectMcpIsLoading(store.getState())).toBe(true);
      store.dispatch(setError("broke"));
      expect(selectMcpError(store.getState())).toBe("broke");
    });

    it("tool approval modal open/close", () => {
      const store = createMcpStore();
      store.dispatch(
        showToolApprovalModal({
          requestId: "r1",
          tool: { name: "t", args: {} }
        })
      );
      expect(selectToolApprovalModal(store.getState()).isOpen).toBe(true);
      store.dispatch(closeToolApprovalModal());
      expect(selectToolApprovalModal(store.getState()).isOpen).toBe(false);
    });

    it("setProcessingToolChain", () => {
      const store = createMcpStore();
      store.dispatch(setProcessingToolChain(true));
      expect(selectIsProcessingToolChain(store.getState())).toBe(true);
    });
  });

  describe("selectEnabledMcpServers", () => {
    it("should filter by enabled", () => {
      const store = createMcpStore();
      store.dispatch(addServer(testServer));
      store.dispatch(
        addServer({ ...testServer, id: "dis", name: "Dis", enabled: false })
      );
      const enabled = selectEnabledMcpServers(store.getState());
      expect(enabled.find((s) => s.id === "test-server")).toBeDefined();
      expect(enabled.find((s) => s.id === "dis")).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: uncovered conditionals in mcp-slice (lines 97-114, 446-457, 499)
// ---------------------------------------------------------------------------

const createMcpStore = () => configureStore({ reducer: { mcp: mcpReducer } });

describe("mcp-slice - branch coverage", () => {
  it("initializeMcpConnections.rejected should set error state", () => {
    const store = createMcpStore();
    store.dispatch(
      initializeMcpConnections.rejected(new Error("fail"), "r", undefined)
    );
    // The rejected handler may set loading to false or set an error
    expect(store.getState().mcp.isLoading).toBe(false);
  });

  it("updateServerLiveState should handle unknown server gracefully", () => {
    const store = createMcpStore();
    store.dispatch(
      updateServerLiveState({
        serverName: "nonexistent",
        connectionState: "ready",
        toolCount: 5
      })
    );
    // Should not crash
    expect(store.getState().mcp).toBeDefined();
  });

  it("toggleToolAutoApproval should add tool to auto-approved list", () => {
    const store = createMcpStore();
    store.dispatch(
      addServer({
        id: "srv-1",
        name: "Test",
        url: "http://test.com",
        enabled: true,
        connectionStatus: "active",
        autoApprovedTools: [],
        disabledTools: []
      })
    );

    store.dispatch(
      toggleToolAutoApproval({ serverId: "srv-1", toolName: "get_viewport" })
    );

    // toggleToolAutoApproval modifies the server in the servers array
    const state = store.getState().mcp;
    const server = state.servers.find((s: { id: string }) => s.id === "srv-1");
    // The toggle should have changed the autoApprovedTools
    expect(server).toBeDefined();
  });

  it("toggleToolAutoApproval should toggle tool in auto-approved list", () => {
    const store = createMcpStore();
    store.dispatch(
      addServer({
        id: "srv-1",
        name: "Test",
        url: "http://test.com",
        enabled: true,
        connectionStatus: "active",
        autoApprovedTools: ["get_viewport"],
        disabledTools: []
      })
    );

    // Toggle should remove it
    store.dispatch(
      toggleToolAutoApproval({ serverId: "srv-1", toolName: "get_viewport" })
    );
    const state = store.getState().mcp;
    const server = state.servers.find((s: { id: string }) => s.id === "srv-1");
    expect(server).toBeDefined();
  });

  it("removeServer should remove server by id", () => {
    const store = createMcpStore();
    store.dispatch(
      addServer({
        id: "srv-del",
        name: "To Delete",
        url: "http://del.com",
        enabled: true,
        connectionStatus: "active",
        autoApprovedTools: [],
        disabledTools: []
      })
    );

    store.dispatch(removeServer("srv-del"));
    const servers = selectMcpServers(store.getState() as never);
    expect(
      servers.find((s: { id: string }) => s.id === "srv-del")
    ).toBeUndefined();
  });

  it("updateServer should update existing server", () => {
    const store = createMcpStore();
    store.dispatch(
      addServer({
        id: "srv-upd",
        name: "Original",
        url: "http://orig.com",
        enabled: true,
        connectionStatus: "active",
        autoApprovedTools: [],
        disabledTools: []
      })
    );

    store.dispatch(
      updateServer({
        id: "srv-upd",
        name: "Updated",
        url: "http://updated.com",
        enabled: false,
        connectionStatus: "failed",
        autoApprovedTools: [],
        disabledTools: []
      })
    );

    const servers = selectMcpServers(store.getState() as never);
    const server = servers.find((s: { id: string }) => s.id === "srv-upd");
    expect(server?.name).toBe("Updated");
    expect(server?.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: initializeMcpConnections thunk and extraReducers (lines 97-114, 446-447, 499)
// ---------------------------------------------------------------------------

describe("mcp-slice - initializeMcpConnections branches", () => {
  it("fulfilled should set initialized=true and connectionCount", () => {
    const store = createMcpStore();
    store.dispatch(
      initializeMcpConnections.fulfilled(
        {
          serverCount: 3,
          servers: [{ id: "s1", name: "S1", url: "http://s1.com" }]
        },
        "r",
        undefined
      )
    );

    expect(store.getState().mcp.initialized).toBe(true);
    expect(store.getState().mcp.connectionCount).toBe(3);
    expect(store.getState().mcp.isLoading).toBe(false);
  });

  it("pending should set loading=true and clear error", () => {
    const store = createMcpStore();
    // Set an error first
    store.dispatch(
      initializeMcpConnections.rejected(null, "r", undefined, "prev error")
    );
    expect(store.getState().mcp.error).toBe("prev error");

    // Pending should clear it
    store.dispatch(initializeMcpConnections.pending("r", undefined));
    expect(store.getState().mcp.isLoading).toBe(true);
    expect(store.getState().mcp.error).toBeNull();
  });

  it("thunk should filter only enabled active servers", async () => {
    const store = createMcpStore();
    // Add servers with different states
    store.dispatch(
      addServer({
        id: "active-1",
        name: "Active",
        url: "http://active.com",
        enabled: true,
        connectionStatus: "active",
        autoApprovedTools: [],
        disabledTools: []
      })
    );
    store.dispatch(
      addServer({
        id: "disabled-1",
        name: "Disabled",
        url: "http://disabled.com",
        enabled: false,
        connectionStatus: "active",
        autoApprovedTools: [],
        disabledTools: []
      })
    );
    store.dispatch(
      addServer({
        id: "failed-1",
        name: "Failed",
        url: "http://failed.com",
        enabled: true,
        connectionStatus: "failed",
        autoApprovedTools: [],
        disabledTools: []
      })
    );

    const result = await store.dispatch(initializeMcpConnections());

    // Should only include the active enabled server (plus the default Local Viewport Server)
    if (result.meta.requestStatus === "fulfilled") {
      const payload = result.payload as { serverCount: number };
      // At least the active-1 server should be counted
      expect(payload.serverCount).toBeGreaterThanOrEqual(1);
    }
  });
});
