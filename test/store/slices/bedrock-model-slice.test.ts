// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for bedrock-model-slice.ts sync reducers.
 * Covers setSelectedModel, clearError, clearModels, setDefaultModel, setConnectionStatus.
 */

import { configureStore } from "@reduxjs/toolkit";

import bedrockModelReducer, {
  clearError,
  clearModels,
  setConnectionStatus,
  setDefaultModel,
  setSelectedModel
} from "@/store/slices/bedrock-model-slice";

jest.mock("@/services/bedrock-service", () => ({
  bedrockModelsService: {
    getAvailableModels: jest.fn()
  }
}));

const makeModel = (id: string, name: string) => ({
  modelId: id,
  modelName: name,
  providerName: "Anthropic",
  inputModalities: ["TEXT"],
  outputModalities: ["TEXT"],
  supportsStreaming: true,
  supportsToolUse: true,
  modelLifecycle: "ACTIVE",
  customizationsSupported: [] as string[],
  inferenceTypesSupported: [] as string[]
});

const createStore = () =>
  configureStore({ reducer: { bedrockModel: bedrockModelReducer } });

describe("bedrock-model-slice", () => {
  describe("setSelectedModel", () => {
    it("should set selected model and reset connection status to disconnected", () => {
      const store = createStore();
      store.dispatch(
        setSelectedModel(makeModel("claude-opus-4-6", "Claude Opus 4.6"))
      );
      expect(store.getState().bedrockModel.selectedModel?.modelId).toBe(
        "claude-opus-4-6"
      );
      expect(store.getState().bedrockModel.connectionStatus).toBe(
        "disconnected"
      );
    });

    it("should allow setting to null", () => {
      const store = createStore();
      store.dispatch(setSelectedModel(makeModel("m1", "Model 1")));
      store.dispatch(setSelectedModel(null));
      expect(store.getState().bedrockModel.selectedModel).toBeNull();
    });
  });

  describe("clearError", () => {
    it("should clear error", () => {
      const store = createStore();
      store.dispatch(clearError());
      expect(store.getState().bedrockModel.error).toBeNull();
    });
  });

  describe("setConnectionStatus", () => {
    it("should update connection status", () => {
      const store = createStore();
      store.dispatch(setConnectionStatus("connecting"));
      expect(store.getState().bedrockModel.connectionStatus).toBe("connecting");
      store.dispatch(setConnectionStatus("connected"));
      expect(store.getState().bedrockModel.connectionStatus).toBe("connected");
      store.dispatch(setConnectionStatus("failed"));
      expect(store.getState().bedrockModel.connectionStatus).toBe("failed");
    });
  });

  describe("clearModels", () => {
    it("should reset all model state", () => {
      const store = createStore();
      store.dispatch(setSelectedModel(makeModel("m1", "Model 1")));
      store.dispatch(setConnectionStatus("connected"));
      store.dispatch(clearModels());

      const state = store.getState().bedrockModel;
      expect(state.availableModels).toEqual([]);
      expect(state.selectedModel).toBeNull();
      expect(state.lastFetched).toBeNull();
      expect(state.connectionStatus).toBe("disconnected");
    });
  });

  describe("setDefaultModel", () => {
    it("should do nothing when no models available", () => {
      const store = createStore();
      store.dispatch(setDefaultModel());
      expect(store.getState().bedrockModel.selectedModel).toBeNull();
    });

    it("should do nothing when a model is already selected", () => {
      const store = createStore();
      store.dispatch(setSelectedModel(makeModel("m1", "Model 1")));
      store.dispatch(setDefaultModel());
      expect(store.getState().bedrockModel.selectedModel?.modelId).toBe("m1");
    });
  });
});

// ---------------------------------------------------------------------------
// Async thunk extraReducers
// ---------------------------------------------------------------------------

import { fetchAvailableModels } from "@/store/slices/bedrock-model-slice";

describe("bedrock-model-slice async thunks", () => {
  it("pending should set loading", () => {
    const store = createStore();
    store.dispatch(fetchAvailableModels.pending("r", undefined));
    expect(store.getState().bedrockModel.isLoading).toBe(true);
  });

  it("fulfilled should auto-select Claude Opus 4.6", () => {
    const store = createStore();
    const models = [
      {
        modelId: "us.anthropic.claude-opus-4-6-20250929-v1:0",
        modelName: "Claude Opus 4.6"
      },
      {
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        modelName: "Claude Sonnet 4.5"
      }
    ];
    store.dispatch(
      fetchAvailableModels.fulfilled(models as never, "r", undefined)
    );
    expect(store.getState().bedrockModel.selectedModel?.modelId).toContain(
      "claude-opus-4-6"
    );
  });

  it("fulfilled should fall back to first Claude model", () => {
    const store = createStore();
    const models = [
      {
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        modelName: "Claude Sonnet 4.5"
      },
      { modelId: "us.meta.llama-3-70b", modelName: "Llama 3" }
    ];
    store.dispatch(
      fetchAvailableModels.fulfilled(models as never, "r", undefined)
    );
    expect(store.getState().bedrockModel.selectedModel?.modelId).toContain(
      "claude"
    );
  });

  it("fulfilled should fall back to first model when no Claude", () => {
    const store = createStore();
    store.dispatch(
      fetchAvailableModels.fulfilled(
        [{ modelId: "llama", modelName: "Llama" }] as never,
        "r",
        undefined
      )
    );
    expect(store.getState().bedrockModel.selectedModel?.modelId).toBe("llama");
  });

  it("rejected should set error", () => {
    const store = createStore();
    store.dispatch(
      fetchAvailableModels.rejected(null, "r", undefined, "Network error")
    );
    expect(store.getState().bedrockModel.error).toBe("Network error");
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for setDefaultModel with models (lines 75-87)
// ---------------------------------------------------------------------------

describe("bedrock-model-slice - setDefaultModel with models", () => {
  it("should select Claude Opus 4.6 when available", () => {
    const store = createStore();
    // Populate models via fulfilled action
    store.dispatch(
      fetchAvailableModels.fulfilled(
        [
          makeModel(
            "us.anthropic.claude-opus-4-6-20250929-v1:0",
            "Claude Opus 4.6"
          ),
          makeModel(
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "Claude Sonnet 4.5"
          )
        ] as never,
        "r",
        undefined
      )
    );

    // Clear selection to test setDefaultModel
    store.dispatch(setSelectedModel(null));
    store.dispatch(setDefaultModel());

    expect(store.getState().bedrockModel.selectedModel?.modelId).toContain(
      "claude-opus-4-6"
    );
  });

  it("should fall back to first Claude model when Opus 4.6 not available", () => {
    const store = createStore();
    store.dispatch(
      fetchAvailableModels.fulfilled(
        [
          makeModel("us.meta.llama-3-70b", "Llama 3"),
          makeModel(
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "Claude Sonnet 4.5"
          )
        ] as never,
        "r",
        undefined
      )
    );

    store.dispatch(setSelectedModel(null));
    store.dispatch(setDefaultModel());

    expect(store.getState().bedrockModel.selectedModel?.modelId).toContain(
      "claude"
    );
  });

  it("should fall back to first model when no Claude models available", () => {
    const store = createStore();
    store.dispatch(
      fetchAvailableModels.fulfilled(
        [
          makeModel("us.meta.llama-3-70b", "Llama 3"),
          makeModel("us.ai21.jamba-1-5-large", "Jamba 1.5")
        ] as never,
        "r",
        undefined
      )
    );

    store.dispatch(setSelectedModel(null));
    store.dispatch(setDefaultModel());

    expect(store.getState().bedrockModel.selectedModel?.modelId).toBe(
      "us.meta.llama-3-70b"
    );
  });

  it("fulfilled with empty models should not select anything", () => {
    const store = createStore();
    store.dispatch(fetchAvailableModels.fulfilled([] as never, "r", undefined));
    expect(store.getState().bedrockModel.selectedModel).toBeNull();
  });
});
