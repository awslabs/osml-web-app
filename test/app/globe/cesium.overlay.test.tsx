// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for Globe Page overlay consumption.
 *
 * The Globe Page uses Cesium/Resium, which is complex to unit test in jsdom.
 * Instead of testing the full component render, these tests verify the DATA
 * FLOW logic that the Globe Page depends on:
 *
 * 1. Detection layer data is read from GeoJSONCacheService (renders as GeoJsonDataSource)
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
      properties: { score: 0.92 }
    },
    {
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [3, 3],
            [4, 3],
            [4, 4],
            [3, 4],
            [3, 3]
          ]
        ]
      },
      properties: { score: 0.78 }
    }
  ]
};

/** Sample agent feature. */
const sampleAgentFeature: GeoJSONFeature = {
  type: "Feature",
  id: "agent-globe-1",
  geometry: { type: "Point", coordinates: [-122.4, 37.8] },
  properties: {
    createdBy: "agent",
    createdAt: "2025-01-15T00:00:00.000Z",
    description: "Globe agent feature"
  }
};

/** Sample detection overlay layer. */
const sampleDetectionLayer: OverlayLayer = {
  id: "detection-globe-job-1",
  name: "Detection: globe-job-1",
  source: "detection",
  zIndex: 10,
  featureCount: 2,
  metadata: { jobId: "globe-job-1", loading: false }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Globe Page overlay consumption (useOverlayLayerData)", () => {
  beforeEach(() => {
    GeoJSONCacheService.resetInstance();
  });

  // =========================================================================
  // Test 1: Detection layer data is read from GeoJSONCacheService
  //         (renders as GeoJsonDataSource on the globe)
  // =========================================================================

  describe("detection layer data from cache (GeoJsonDataSource source)", () => {
    it("returns FeatureCollection from GeoJSONCacheService when detection layer exists", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      store.dispatch(addLayer(sampleDetectionLayer));
      cache.set("detection-globe-job-1", sampleDetectionData);

      const { result } = renderHook(
        () => useOverlayLayerData("detection-globe-job-1"),
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
        () => useOverlayLayerData("detection-globe-job-1"),
        { wrapper: createWrapper(store) }
      );

      // Initially null — no cache data yet
      expect(result.current).toBeNull();

      // Set cache data — hook should re-render with the data
      act(() => {
        cache.set("detection-globe-job-1", sampleDetectionData);
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

      // addFeature auto-creates the "agent-features" layer
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
      expect(result.current!.features[0].id).toBe("agent-globe-1");
    });

    it("returns null when agent-features layer has no features", () => {
      const store = createTestStore();

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

      const secondFeature: GeoJSONFeature = {
        ...sampleAgentFeature,
        id: "agent-globe-2",
        properties: {
          ...sampleAgentFeature.properties,
          description: "Second globe feature"
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
          id: "detection-globe-job-2",
          name: "Detection: globe-job-2",
          metadata: { jobId: "globe-job-2", loading: false }
        })
      );

      const state = store.getState().overlay;
      const renderableIds = state.layerOrder.filter((id) => !!state.layers[id]);

      expect(renderableIds).toContain("detection-globe-job-1");
      expect(renderableIds).toContain("detection-globe-job-2");
    });

    it("removing a layer makes it no longer renderable", () => {
      const store = createTestStore();

      store.dispatch(addLayer(sampleDetectionLayer));
      expect(
        store.getState().overlay.layers["detection-globe-job-1"]
      ).toBeDefined();

      store.dispatch(removeLayer("detection-globe-job-1"));
      expect(
        store.getState().overlay.layers["detection-globe-job-1"]
      ).toBeUndefined();
      expect(store.getState().overlay.layerOrder).not.toContain(
        "detection-globe-job-1"
      );
    });
  });

  // =========================================================================
  // Test 4: Missing cache entries (null) don't cause errors
  // =========================================================================

  describe("missing cache entries", () => {
    it("returns null when detection layer exists but cache has no data", () => {
      const store = createTestStore();

      // Add detection layer but DON'T put data in cache
      store.dispatch(addLayer(sampleDetectionLayer));

      const { result } = renderHook(
        () => useOverlayLayerData("detection-globe-job-1"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).toBeNull();
    });

    it("returns null for a layer ID that doesn't exist at all", () => {
      const store = createTestStore();

      const { result } = renderHook(
        () => useOverlayLayerData("nonexistent-globe-layer"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).toBeNull();
    });

    it("returns null after cache entry is deleted", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      store.dispatch(addLayer(sampleDetectionLayer));
      cache.set("detection-globe-job-1", sampleDetectionData);

      const { result } = renderHook(
        () => useOverlayLayerData("detection-globe-job-1"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).not.toBeNull();

      // Delete cache entry
      act(() => {
        cache.delete("detection-globe-job-1");
      });

      expect(result.current).toBeNull();
    });
  });
});
