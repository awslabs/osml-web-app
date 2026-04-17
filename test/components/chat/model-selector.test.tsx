// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ModelSelector component.
 * Covers loading state, error state, empty models, model list, and selection.
 */

import { screen } from "@testing-library/react";

import { ModelSelector } from "@/components/chat/model-selector";
import { fetchAvailableModels } from "@/store/slices/bedrock-model-slice";

jest.mock("@/services/bedrock-service", () => ({
  bedrockModelsService: {
    getAvailableModels: jest.fn(),
    getModelDisplayName: (m: { modelName: string; modelId: string }) =>
      m.modelName || m.modelId
  }
}));

import { createTestStore, renderWithStore } from "../../test-utils";

describe("ModelSelector", () => {
  it("should show loading spinner when models are loading", () => {
    const store = createTestStore();
    store.dispatch(fetchAvailableModels.pending("r", undefined));

    renderWithStore(<ModelSelector isConnected={false} />, { store });
    expect(screen.getByText("Loading models...")).toBeInTheDocument();
  });

  it("should show error chip when fetch fails", () => {
    const store = createTestStore();
    store.dispatch(
      fetchAvailableModels.rejected(null, "r", undefined, "Network error")
    );

    renderWithStore(<ModelSelector isConnected={false} />, { store });
    expect(screen.getByText("Model Error")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("should show 'No Models Available' when list is empty", () => {
    const store = createTestStore();
    store.dispatch(fetchAvailableModels.fulfilled([], "r", undefined));

    renderWithStore(<ModelSelector isConnected={false} />, { store });
    expect(screen.getByText("No Models Available")).toBeInTheDocument();
  });

  it("should render model select when models available", () => {
    const store = createTestStore();
    const models = [
      {
        modelId: "claude-1",
        modelName: "Claude",
        providerName: "Anthropic",
        inputModalities: ["TEXT"],
        outputModalities: ["TEXT"],
        supportsStreaming: true,
        supportsToolUse: true,
        modelLifecycle: "ACTIVE",
        customizationsSupported: [],
        inferenceTypesSupported: []
      }
    ];
    store.dispatch(
      fetchAvailableModels.fulfilled(models as never, "r", undefined)
    );

    renderWithStore(<ModelSelector isConnected={false} />, { store });
    expect(screen.getByLabelText("Select AI Model")).toBeInTheDocument();
  });

  it("should always render refresh button", () => {
    renderWithStore(<ModelSelector isConnected={false} />);
    expect(screen.getByLabelText("Refresh models")).toBeInTheDocument();
  });
});
