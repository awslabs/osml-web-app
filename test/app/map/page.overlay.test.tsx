// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for Map Page overlay consumption.
 *
 * The Map Page is a complex component with OpenLayers, which is hard to
 * unit test in jsdom. Instead of testing the full component render, these
 * tests verify the DATA FLOW logic:
 *
 * 1. Detection layer data is read from GeoJSONCacheService when overlay layer exists
 * 2. Agent features are read from state.overlay.inlineFeatures["agent-features"]
 * 3. Layer presence in overlay.layers = rendered (no separate visibility flag)
 * 4. Missing cache entries (null) don't cause errors
 *
 * We test the useOverlayLayerData hook directly using renderHook.
 */

import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";

import { useOverlayLayerData } from "@/hooks/use-overlay-layer-data";
import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import overlayReducer, {
  addFeature,
  addLayer,
  GeoJSONFeature,
  OverlayLayer,
  removeLayer
} from "@/store/slices/overlay-slice";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Redux store with just the overlay slice for testing. */
function createTestStore() {
  return configureStore({
    reducer: { overlay: overlayReducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware()
  });
}

/** Wrapper component that provides the Redux store to hooks. */
function createWrapper(store: ReturnType<typeof createTestStore>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(Provider, { store, children });
  };
}

/** Sample detection FeatureCollection for cache tests. */
const sampleDetectionData = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0]
          ]
        ]
      },
      properties: { score: 0.95 }
    },
    {
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [2, 2],
            [3, 2],
            [3, 3],
            [2, 3],
            [2, 2]
          ]
        ]
      },
      properties: { score: 0.87 }
    }
  ]
};

/** Sample agent feature. */
const sampleAgentFeature: GeoJSONFeature = {
  type: "Feature",
  id: "agent-feat-1",
  geometry: { type: "Point", coordinates: [10, 20] },
  properties: {
    createdBy: "agent",
    createdAt: "2025-01-01T00:00:00.000Z",
    description: "Test agent feature"
  }
};

/** Sample detection overlay layer. */
const sampleDetectionLayer: OverlayLayer = {
  id: "detection-job-123",
  name: "Detection: job-123",
  source: "detection",
  zIndex: 10,
  featureCount: 2,
  metadata: { jobId: "job-123", loading: false }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Map Page overlay consumption (useOverlayLayerData)", () => {
  beforeEach(() => {
    GeoJSONCacheService.resetInstance();
  });

  // =========================================================================
  // Test 1: Detection layer data is read from GeoJSONCacheService
  // =========================================================================

  describe("detection layer data from cache", () => {
    it("returns FeatureCollection from GeoJSONCacheService when overlay layer exists", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      // Set up: add detection layer to overlay state and data to cache
      store.dispatch(addLayer(sampleDetectionLayer));
      cache.set("detection-job-123", sampleDetectionData);

      const { result } = renderHook(
        () => useOverlayLayerData("detection-job-123"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).not.toBeNull();
      expect(result.current!.type).toBe("FeatureCollection");
      expect(result.current!.features).toHaveLength(2);
      expect(result.current!.features).toEqual(sampleDetectionData.features);
    });

    it("re-renders when cache data changes for a detection layer", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      store.dispatch(addLayer(sampleDetectionLayer));

      const { result } = renderHook(
        () => useOverlayLayerData("detection-job-123"),
        { wrapper: createWrapper(store) }
      );

      // Initially null (no cache data yet)
      expect(result.current).toBeNull();

      // Set cache data — hook should re-render with the data
      act(() => {
        cache.set("detection-job-123", sampleDetectionData);
      });

      expect(result.current).not.toBeNull();
      expect(result.current!.features).toHaveLength(2);
    });
  });

  // =========================================================================
  // Test 2: Agent features are read from inlineFeatures["agent-features"]
  // =========================================================================

  describe("agent features from inline features", () => {
    it("returns FeatureCollection built from inlineFeatures['agent-features']", () => {
      const store = createTestStore();

      // Add an agent feature — this auto-creates the "agent-features" layer
      store.dispatch(
        addFeature({ feature: sampleAgentFeature, updatedBy: "agent" })
      );

      const { result } = renderHook(
        () => useOverlayLayerData("agent-features"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).not.toBeNull();
      expect(result.current!.type).toBe("FeatureCollection");
      expect(result.current!.features).toHaveLength(1);
      expect(result.current!.features[0].id).toBe("agent-feat-1");
    });

    it("returns null when agent-features layer has no features", () => {
      const store = createTestStore();

      // Create the layer but with no features
      store.dispatch(
        addLayer({
          id: "agent-features",
          name: "Agent Features",
          source: "agent",
          zIndex: 100,
          featureCount: 0
        })
      );

      const { result } = renderHook(
        () => useOverlayLayerData("agent-features"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).toBeNull();
    });

    it("updates when new agent features are added", () => {
      const store = createTestStore();

      store.dispatch(
        addFeature({ feature: sampleAgentFeature, updatedBy: "agent" })
      );

      const { result } = renderHook(
        () => useOverlayLayerData("agent-features"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current!.features).toHaveLength(1);

      // Add another feature
      const secondFeature: GeoJSONFeature = {
        ...sampleAgentFeature,
        id: "agent-feat-2",
        properties: {
          ...sampleAgentFeature.properties,
          description: "Second feature"
        }
      };

      act(() => {
        store.dispatch(
          addFeature({ feature: secondFeature, updatedBy: "agent" })
        );
      });

      expect(result.current!.features).toHaveLength(2);
    });
  });

  // =========================================================================
  // Test 3: Presence-based rendering
  //
  // Under the new model a layer record's presence in overlay.layers is the
  // sole rendering signal. There is no visibility flag; the jobs-slice
  // middleware adds and removes layer records as jobs enter and leave the
  // selection.
  // =========================================================================

  describe("presence-based rendering", () => {
    it("derives renderable layers from overlay.layers keys", () => {
      const store = createTestStore();

      store.dispatch(addLayer(sampleDetectionLayer));
      store.dispatch(
        addLayer({
          ...sampleDetectionLayer,
          id: "detection-job-456",
          name: "Detection: job-456",
          metadata: { jobId: "job-456", loading: false }
        })
      );

      const state = store.getState().overlay;
      const renderableIds = state.layerOrder.filter((id) => !!state.layers[id]);

      expect(renderableIds).toContain("detection-job-123");
      expect(renderableIds).toContain("detection-job-456");
    });

    it("removing a layer makes it no longer renderable", () => {
      const store = createTestStore();

      store.dispatch(addLayer(sampleDetectionLayer));
      expect(
        store.getState().overlay.layers["detection-job-123"]
      ).toBeDefined();

      store.dispatch(removeLayer("detection-job-123"));
      expect(
        store.getState().overlay.layers["detection-job-123"]
      ).toBeUndefined();
      expect(store.getState().overlay.layerOrder).not.toContain(
        "detection-job-123"
      );
    });
  });

  // =========================================================================
  // Test 4: Missing cache entries (null) don't cause errors
  // =========================================================================

  describe("missing cache entries", () => {
    it("returns null when detection layer exists but cache has no data", () => {
      const store = createTestStore();

      // Add detection layer to overlay state but DON'T put data in cache
      store.dispatch(addLayer(sampleDetectionLayer));

      const { result } = renderHook(
        () => useOverlayLayerData("detection-job-123"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).toBeNull();
    });

    it("returns null for a layer ID that doesn't exist at all", () => {
      const store = createTestStore();

      const { result } = renderHook(
        () => useOverlayLayerData("nonexistent-layer"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).toBeNull();
    });

    it("returns null after cache entry is deleted", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      store.dispatch(addLayer(sampleDetectionLayer));
      cache.set("detection-job-123", sampleDetectionData);

      const { result } = renderHook(
        () => useOverlayLayerData("detection-job-123"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).not.toBeNull();

      // Delete cache entry
      act(() => {
        cache.delete("detection-job-123");
      });

      expect(result.current).toBeNull();
    });
  });
});
