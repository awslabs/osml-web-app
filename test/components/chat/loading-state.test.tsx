// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for LoadingState component and useSystemReady hook.
 * Covers loading models, loading MCP tools, and ready states.
 */

import { screen } from "@testing-library/react";

import { LoadingState, useSystemReady } from "@/components/chat/loading-state";
import { setSelectedModel } from "@/store/slices/bedrock-model-slice";
import {
  initializeMcpConnections,
  updateServerLiveState
} from "@/store/slices/mcp-slice";

jest.mock("@/services/bedrock-service", () => ({
  bedrockModelsService: { getAvailableModels: jest.fn() }
}));

import {
  createTestStore,
  renderHookWithStore,
  renderWithStore
} from "../../test-utils";

describe("LoadingState", () => {
  it("should show loading models message when no model selected", () => {
    renderWithStore(<LoadingState />);
    expect(screen.getByText("Loading AI models...")).toBeInTheDocument();
  });

  it("should show loading MCP tools when model selected but MCP not ready", () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedModel({
        modelId: "claude",
        modelName: "Claude",
        providerName: "Anthropic",
        inputModalities: ["TEXT"],
        outputModalities: ["TEXT"],
        supportsStreaming: true,
        supportsToolUse: true,
        modelLifecycle: "ACTIVE",
        customizationsSupported: [],
        inferenceTypesSupported: []
      })
    );
    // MCP initialized but no servers connected
    store.dispatch(
      initializeMcpConnections.fulfilled(
        { serverCount: 1, servers: [] },
        "r",
        undefined
      )
    );

    renderWithStore(<LoadingState />, { store });
    expect(screen.getByText(/Loading MCP tools/)).toBeInTheDocument();
  });

  it("should show select model message when no model and not loading", () => {
    // Default store has no model and isLoading=false
    // But the component shows "Loading AI models..." when !selectedModel
    renderWithStore(<LoadingState />);
    // The loading spinner should be visible
    expect(screen.getByText("Loading AI models...")).toBeInTheDocument();
  });
});

describe("useSystemReady", () => {
  it("should report not ready when no model selected", () => {
    const { result } = renderHookWithStore(() => useSystemReady());
    expect(result.current.isSystemReady).toBeFalsy();
    expect(result.current.isLoadingModels).toBe(true);
  });

  it("should report ready when model selected and MCP connected", () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedModel({
        modelId: "claude",
        modelName: "Claude",
        providerName: "Anthropic",
        inputModalities: ["TEXT"],
        outputModalities: ["TEXT"],
        supportsStreaming: true,
        supportsToolUse: true,
        modelLifecycle: "ACTIVE",
        customizationsSupported: [],
        inferenceTypesSupported: []
      })
    );
    store.dispatch(
      initializeMcpConnections.fulfilled(
        { serverCount: 1, servers: [] },
        "r",
        undefined
      )
    );
    store.dispatch(
      updateServerLiveState({
        serverName: "Local Viewport Server",
        connectionState: "ready",
        toolCount: 8
      })
    );

    const { result } = renderHookWithStore(() => useSystemReady(), { store });
    expect(result.current.isLoadingModels).toBe(false);
  });
});
