// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for viewport-slice.ts.
 */

import { configureStore } from "@reduxjs/toolkit";

import viewportReducer, { setViewport } from "@/store/slices/viewport-slice";

const createStore = () =>
  configureStore({ reducer: { viewport: viewportReducer } });

describe("viewport-slice", () => {
  it("should have sensible initial state", () => {
    const store = createStore();
    const state = store.getState().viewport;
    expect(state.longitude).toBe(0);
    expect(state.latitude).toBe(0);
    expect(state.zoom).toBe(2);
    expect(state.lastUpdatedBy).toBe("initial");
  });

  it("setViewport should update all fields", () => {
    const store = createStore();
    store.dispatch(
      setViewport({
        longitude: -122.4,
        latitude: 37.8,
        zoom: 12,
        extent: { west: -123, south: 37, east: -122, north: 38 },
        updatedBy: "map"
      })
    );

    const state = store.getState().viewport;
    expect(state.longitude).toBe(-122.4);
    expect(state.latitude).toBe(37.8);
    expect(state.zoom).toBe(12);
    expect(state.lastUpdatedBy).toBe("map");
  });

  it("should track updatedBy source", () => {
    const store = createStore();
    const payload = {
      longitude: 0,
      latitude: 0,
      zoom: 5,
      extent: { west: -10, south: -10, east: 10, north: 10 }
    };

    store.dispatch(setViewport({ ...payload, updatedBy: "globe" }));
    expect(store.getState().viewport.lastUpdatedBy).toBe("globe");

    store.dispatch(setViewport({ ...payload, updatedBy: "agent" }));
    expect(store.getState().viewport.lastUpdatedBy).toBe("agent");
  });
});
