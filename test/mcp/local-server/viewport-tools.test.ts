// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for viewport-tools.ts.
 * Covers get_viewport and zoom_to_location with scale mapping,
 * coordinate validation, and extent calculation.
 */

import { configureStore } from "@reduxjs/toolkit";

import {
  getViewportTool,
  zoomToLocationTool
} from "@/mcp/local-server/viewport-tools";
import viewportReducer from "@/store/slices/viewport-slice";

const createStore = () =>
  configureStore({
    reducer: {
      viewport: viewportReducer,
      settings: () => ({ autoZoomOnLayerToggle: true })
    }
  });

describe("getViewportTool", () => {
  it("should return current viewport state", () => {
    const store = createStore();
    const result = getViewportTool.handler({}, store) as {
      longitude: number;
      latitude: number;
      zoom: number;
      extent: Record<string, number>;
    };

    expect(result).toHaveProperty("longitude");
    expect(result).toHaveProperty("latitude");
    expect(result).toHaveProperty("zoom");
    expect(result).toHaveProperty("extent");
  });
});

describe("zoomToLocationTool", () => {
  it("should navigate to coordinates with explicit zoom", () => {
    const store = createStore();
    const result = zoomToLocationTool.handler(
      { latitude: 37.7749, longitude: -122.4194, zoom: 12 },
      store
    ) as {
      success: boolean;
      viewport: { latitude: number; longitude: number; zoom: number };
    };

    expect(result.success).toBe(true);
    expect(result.viewport.latitude).toBe(37.7749);
    expect(result.viewport.longitude).toBe(-122.4194);
    expect(result.viewport.zoom).toBe(12);
  });

  it("should determine zoom from scale parameter", () => {
    const store = createStore();
    const result = zoomToLocationTool.handler(
      { latitude: 0, longitude: 0, scale: "building" },
      store
    ) as { viewport: { zoom: number } };

    expect(result.viewport.zoom).toBe(18);
  });

  it("should map all scale values correctly", () => {
    const store = createStore();
    const scales: Record<string, number> = {
      building: 18,
      block: 16,
      neighborhood: 14,
      city: 11,
      region: 8,
      state: 6,
      country: 5,
      continent: 3
    };

    for (const [scale, expectedZoom] of Object.entries(scales)) {
      const result = zoomToLocationTool.handler(
        { latitude: 0, longitude: 0, scale },
        store
      ) as { viewport: { zoom: number } };
      expect(result.viewport.zoom).toBe(expectedZoom);
    }
  });

  it("should default to city-level zoom when no zoom or scale provided", () => {
    const store = createStore();
    const result = zoomToLocationTool.handler(
      { latitude: 0, longitude: 0 },
      store
    ) as { viewport: { zoom: number } };

    expect(result.viewport.zoom).toBe(11); // city default
  });

  it("should calculate extent around center point", () => {
    const store = createStore();
    const result = zoomToLocationTool.handler(
      { latitude: 45, longitude: 10, zoom: 10 },
      store
    ) as {
      viewport: {
        extent: { west: number; east: number; south: number; north: number };
      };
    };

    const { extent } = result.viewport;
    expect(extent.west).toBeLessThan(10);
    expect(extent.east).toBeGreaterThan(10);
    expect(extent.south).toBeLessThan(45);
    expect(extent.north).toBeGreaterThan(45);
  });

  it("should clamp extent to valid geographic bounds", () => {
    const store = createStore();
    const result = zoomToLocationTool.handler(
      { latitude: 89, longitude: 179, zoom: 1 },
      store
    ) as { viewport: { extent: { east: number; north: number } } };

    expect(result.viewport.extent.east).toBeLessThanOrEqual(180);
    expect(result.viewport.extent.north).toBeLessThanOrEqual(90);
  });

  it("should throw for invalid latitude", () => {
    const store = createStore();
    expect(() =>
      zoomToLocationTool.handler({ latitude: 91, longitude: 0 }, store)
    ).toThrow("Latitude must be between -90 and 90");
  });

  it("should throw for invalid longitude", () => {
    const store = createStore();
    expect(() =>
      zoomToLocationTool.handler({ latitude: 0, longitude: 181 }, store)
    ).toThrow("Longitude must be between -180 and 180");
  });

  it("should update Redux viewport state", () => {
    const store = createStore();
    zoomToLocationTool.handler(
      { latitude: 40, longitude: -74, zoom: 10 },
      store
    );

    const state = store.getState().viewport;
    expect(state.latitude).toBe(40);
    expect(state.longitude).toBe(-74);
    expect(state.zoom).toBe(10);
    expect(state.lastUpdatedBy).toBe("agent");
  });
});
