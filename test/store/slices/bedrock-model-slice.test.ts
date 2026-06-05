// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for bedrock-model-slice.ts sync reducers.
 * Covers setSelectedModel, clearError, and clearModels.
 */

import { configureStore } from "@reduxjs/toolkit";

import bedrockModelReducer, {
  clearError,
  clearModels,
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

  describe("clearModels", () => {
    it("should reset all model state", () => {
      const store = createStore();
      store.dispatch(setSelectedModel(makeModel("m1", "Model 1")));
      store.dispatch(clearModels());

      const state = store.getState().bedrockModel;
      expect(state.availableModels).toEqual([]);
      expect(state.selectedModel).toBeNull();
      expect(state.lastFetched).toBeNull();
      expect(state.connectionStatus).toBe("disconnected");
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

  it("fulfilled selects the first model when no preference is set", () => {
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
      fetchAvailableModels.fulfilled(
        { models, preferredModelId: null } as never,
        "r",
        undefined
      )
    );
    expect(store.getState().bedrockModel.selectedModel?.modelId).toBe(
      models[0].modelId
    );
  });

  it("fulfilled selects the first model regardless of provider", () => {
    const store = createStore();
    const models = [
      { modelId: "us.meta.llama-3-70b", modelName: "Llama 3" },
      {
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        modelName: "Claude Sonnet 4.5"
      }
    ];
    store.dispatch(
      fetchAvailableModels.fulfilled(
        { models, preferredModelId: null } as never,
        "r",
        undefined
      )
    );
    expect(store.getState().bedrockModel.selectedModel?.modelId).toBe(
      "us.meta.llama-3-70b"
    );
  });

  it("fulfilled selects the only model when the list has one entry", () => {
    const store = createStore();
    store.dispatch(
      fetchAvailableModels.fulfilled(
        {
          models: [{ modelId: "llama", modelName: "Llama" }],
          preferredModelId: null
        } as never,
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
// selectDefaultBedrockModel helper
// ---------------------------------------------------------------------------

import { selectDefaultBedrockModel } from "@/store/slices/bedrock-model-slice";

describe("selectDefaultBedrockModel", () => {
  const opus = makeModel(
    "us.anthropic.claude-opus-4-6-20250929-v1:0",
    "Claude Opus 4.6"
  );
  const sonnet = makeModel(
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "Claude Sonnet 4.5"
  );
  const llama = makeModel("us.meta.llama-3-70b", "Llama 3");

  it("returns null for empty list", () => {
    expect(selectDefaultBedrockModel([])).toBeNull();
  });

  it("returns the preferred model when present", () => {
    const result = selectDefaultBedrockModel([opus, sonnet], sonnet.modelId);
    expect(result?.modelId).toBe(sonnet.modelId);
  });

  it("ignores a stale preferred ID and falls back to the first model", () => {
    const result = selectDefaultBedrockModel([opus, sonnet], "no-such-model");
    expect(result?.modelId).toBe(opus.modelId);
  });

  it("falls back to the first model when the preferred ID is not present", () => {
    const result = selectDefaultBedrockModel([llama, sonnet]);
    expect(result?.modelId).toBe(llama.modelId);
  });

  it("returns the only model when the list has one entry", () => {
    const result = selectDefaultBedrockModel([llama]);
    expect(result?.modelId).toBe(llama.modelId);
  });

  it("treats null preferred ID the same as undefined", () => {
    const result = selectDefaultBedrockModel([opus, sonnet], null);
    expect(result?.modelId).toBe(opus.modelId);
  });
});

// ---------------------------------------------------------------------------
// fetchAvailableModels.fulfilled — preferredModelId path
// ---------------------------------------------------------------------------

describe("fetchAvailableModels.fulfilled — preferredModelId", () => {
  it("selects the preferred model when it is in the list", () => {
    const store = createStore();
    const models = [
      makeModel(
        "us.anthropic.claude-opus-4-6-20250929-v1:0",
        "Claude Opus 4.6"
      ),
      makeModel(
        "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "Claude Sonnet 4.5"
      )
    ];
    store.dispatch(
      fetchAvailableModels.fulfilled(
        {
          models,
          preferredModelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
        } as never,
        "r",
        undefined
      )
    );
    expect(store.getState().bedrockModel.selectedModel?.modelId).toBe(
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
    );
  });

  it("falls back to the first model when the preferred ID is not available", () => {
    const store = createStore();
    const models = [
      makeModel(
        "us.anthropic.claude-opus-4-6-20250929-v1:0",
        "Claude Opus 4.6"
      ),
      makeModel(
        "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "Claude Sonnet 4.5"
      )
    ];
    store.dispatch(
      fetchAvailableModels.fulfilled(
        { models, preferredModelId: "no-such-model" } as never,
        "r",
        undefined
      )
    );
    expect(store.getState().bedrockModel.selectedModel?.modelId).toBe(
      models[0].modelId
    );
  });

  it("does not override an already-selected model", () => {
    const store = createStore();
    store.dispatch(setSelectedModel(makeModel("m-locked", "Locked")));
    const models = [
      makeModel("us.anthropic.claude-opus-4-6-20250929-v1:0", "Claude Opus 4.6")
    ];
    store.dispatch(
      fetchAvailableModels.fulfilled(
        {
          models,
          preferredModelId: "us.anthropic.claude-opus-4-6-20250929-v1:0"
        } as never,
        "r",
        undefined
      )
    );
    expect(store.getState().bedrockModel.selectedModel?.modelId).toBe(
      "m-locked"
    );
  });
});
