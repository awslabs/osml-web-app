// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for sagemaker-endpoint-slice.ts.
 */

import { configureStore } from "@reduxjs/toolkit";

import sagemakerEndpointReducer, {
  clearEndpoints,
  clearError,
  fetchSageMakerEndpoints,
  setSelectedEndpoint
} from "@/store/slices/sagemaker-endpoint-slice";

jest.mock("@/services/sagemaker-service", () => ({
  sagemakerService: { getEndpoints: jest.fn() }
}));

const createStore = () =>
  configureStore({ reducer: { sagemakerEndpoint: sagemakerEndpointReducer } });

describe("sagemaker-endpoint-slice", () => {
  it("setSelectedEndpoint should update selection", () => {
    const store = createStore();
    store.dispatch(setSelectedEndpoint("my-endpoint"));
    expect(store.getState().sagemakerEndpoint.selectedEndpoint).toBe(
      "my-endpoint"
    );
  });

  it("clearError should reset error", () => {
    const store = createStore();
    store.dispatch(clearError());
    expect(store.getState().sagemakerEndpoint.error).toBeNull();
  });

  it("clearEndpoints should reset all state", () => {
    const store = createStore();
    store.dispatch(setSelectedEndpoint("ep-1"));
    store.dispatch(clearEndpoints());

    const state = store.getState().sagemakerEndpoint;
    expect(state.endpoints).toEqual([]);
    expect(state.selectedEndpoint).toBeNull();
    expect(state.lastFetched).toBeNull();
    expect(state.isLoading).toBe(false);
  });
});

describe("sagemaker-endpoint-slice async thunks", () => {
  it("pending should set loading", () => {
    const store = createStore();
    store.dispatch(fetchSageMakerEndpoints.pending("r", undefined));
    expect(store.getState().sagemakerEndpoint.isLoading).toBe(true);
  });

  it("fulfilled should auto-select sam3", () => {
    const store = createStore();
    const endpoints = [
      { name: "other", status: "InService", creationTime: null },
      { name: "sam3", status: "InService", creationTime: null }
    ];
    store.dispatch(
      fetchSageMakerEndpoints.fulfilled(endpoints, "r", undefined)
    );
    expect(store.getState().sagemakerEndpoint.selectedEndpoint).toBe("sam3");
  });

  it("fulfilled should fall back to first endpoint", () => {
    const store = createStore();
    store.dispatch(
      fetchSageMakerEndpoints.fulfilled(
        [{ name: "flood", status: "InService", creationTime: null }],
        "r",
        undefined
      )
    );
    expect(store.getState().sagemakerEndpoint.selectedEndpoint).toBe("flood");
  });

  it("rejected should set error and clear", () => {
    const store = createStore();
    store.dispatch(
      fetchSageMakerEndpoints.rejected(null, "r", undefined, "Network error")
    );
    expect(store.getState().sagemakerEndpoint.error).toBe("Network error");
    expect(store.getState().sagemakerEndpoint.endpoints).toEqual([]);
  });
});
