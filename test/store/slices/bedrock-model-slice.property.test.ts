// Copyright Amazon.com, Inc. or its affiliates.
import { configureStore } from "@reduxjs/toolkit";
import * as fc from "fast-check";

import { BedrockModel } from "@/services/bedrock-service";
import bedrockModelReducer, {
  fetchAvailableModels,
  setSelectedModel
} from "@/store/slices/bedrock-model-slice";

// Mock the bedrock service
jest.mock("@/services/bedrock-service", () => ({
  bedrockModelsService: {
    getAvailableModels: jest.fn()
  }
}));

describe("BedrockModelSlice - Property-Based Tests", () => {
  describe("Model Selection Persistence", () => {
    it("should persist selected model across multiple state updates", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              modelId: fc.string({ minLength: 1 }),
              modelName: fc.string(),
              providerName: fc.string(),
              inputModalities: fc.array(fc.string()),
              outputModalities: fc.array(fc.string()),
              supportsStreaming: fc.boolean(),
              supportsToolUse: fc.boolean(),
              modelLifecycle: fc.string(),
              customizationsSupported: fc.array(fc.string()),
              inferenceTypesSupported: fc.array(fc.string())
            }),
            { minLength: 1, maxLength: 5 }
          ),
          fc.nat({ max: 10 }),
          (models: BedrockModel[], numUpdates: number) => {
            const store = configureStore({
              reducer: { bedrockModel: bedrockModelReducer }
            });
            const selectedModel = models[0];
            store.dispatch(setSelectedModel(selectedModel));
            let state = store.getState().bedrockModel;
            expect(state.selectedModel).toEqual(selectedModel);
            for (let i = 0; i < numUpdates; i++) {
              store.dispatch(
                fetchAvailableModels.pending("test", undefined, undefined)
              );
              state = store.getState().bedrockModel;
              expect(state.selectedModel).toEqual(selectedModel);
            }
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it("should update selected model when setSelectedModel is dispatched", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              modelId: fc.string({ minLength: 1 }),
              modelName: fc.string(),
              providerName: fc.string(),
              inputModalities: fc.array(fc.string()),
              outputModalities: fc.array(fc.string()),
              supportsStreaming: fc.boolean(),
              supportsToolUse: fc.boolean(),
              modelLifecycle: fc.string(),
              customizationsSupported: fc.array(fc.string()),
              inferenceTypesSupported: fc.array(fc.string())
            }),
            { minLength: 2, maxLength: 5 }
          ),
          (models: BedrockModel[]) => {
            const store = configureStore({
              reducer: { bedrockModel: bedrockModelReducer }
            });
            store.dispatch(setSelectedModel(models[0]));
            store.dispatch(setSelectedModel(models[1]));
            const state = store.getState().bedrockModel;
            expect(state.selectedModel).toEqual(models[1]);
            expect(state.selectedModel).not.toEqual(models[0]);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it("should preserve selection when available models are updated", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              modelId: fc.string({ minLength: 1 }),
              modelName: fc.string(),
              providerName: fc.string(),
              inputModalities: fc.array(fc.string()),
              outputModalities: fc.array(fc.string()),
              supportsStreaming: fc.boolean(),
              supportsToolUse: fc.boolean(),
              modelLifecycle: fc.string(),
              customizationsSupported: fc.array(fc.string()),
              inferenceTypesSupported: fc.array(fc.string())
            }),
            { minLength: 1, maxLength: 5 }
          ),
          fc.array(
            fc.record({
              modelId: fc.string({ minLength: 1 }),
              modelName: fc.string(),
              providerName: fc.string(),
              inputModalities: fc.array(fc.string()),
              outputModalities: fc.array(fc.string()),
              supportsStreaming: fc.boolean(),
              supportsToolUse: fc.boolean(),
              modelLifecycle: fc.string(),
              customizationsSupported: fc.array(fc.string()),
              inferenceTypesSupported: fc.array(fc.string())
            }),
            { minLength: 1, maxLength: 5 }
          ),
          (initialModels: BedrockModel[], newModels: BedrockModel[]) => {
            const store = configureStore({
              reducer: { bedrockModel: bedrockModelReducer }
            });
            store.dispatch(
              fetchAvailableModels.fulfilled(
                { models: initialModels, preferredModelId: null } as never,
                "test",
                undefined
              )
            );
            const selectedModel = initialModels[0];
            store.dispatch(setSelectedModel(selectedModel));
            store.dispatch(
              fetchAvailableModels.fulfilled(
                { models: newModels, preferredModelId: null } as never,
                "test",
                undefined
              )
            );
            expect(store.getState().bedrockModel.selectedModel).toEqual(
              selectedModel
            );
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it("should clear selection when setSelectedModel(null) is dispatched", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              modelId: fc.string({ minLength: 1 }),
              modelName: fc.string(),
              providerName: fc.string(),
              inputModalities: fc.array(fc.string()),
              outputModalities: fc.array(fc.string()),
              supportsStreaming: fc.boolean(),
              supportsToolUse: fc.boolean(),
              modelLifecycle: fc.string(),
              customizationsSupported: fc.array(fc.string()),
              inferenceTypesSupported: fc.array(fc.string())
            }),
            { minLength: 1, maxLength: 5 }
          ),
          (models: BedrockModel[]) => {
            const store = configureStore({
              reducer: { bedrockModel: bedrockModelReducer }
            });
            store.dispatch(setSelectedModel(models[0]));
            store.dispatch(setSelectedModel(null));
            expect(store.getState().bedrockModel.selectedModel).toBeNull();
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
