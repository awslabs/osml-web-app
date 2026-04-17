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
 * 3. Layers with visible: false are not included in rendering data
 * 4. Missing cache entries (null) don't cause errors
 *
 * We test the useOverlayLayerData hook directly using renderHook.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
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
  setLayerVisibility
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

/** Sample detection FeatureCollection for cache tests (rendered as GeoJsonDataSource on globe). */
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
  visible: true,
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
  // Validates: Requirements 6.1, 6.2
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
  // Validates: Requirements 6.1, 6.3
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
          visible: true,
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
  // Test 3: Layers with visible: false are not included in rendering data
  // Validates: Requirements 6.4
  // =========================================================================

  describe("layer visibility filtering", () => {
    it("layer data is still returned by hook even when visible is false (view handles visibility)", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      store.dispatch(addLayer({ ...sampleDetectionLayer, visible: false }));
      cache.set("detection-globe-job-1", sampleDetectionData);

      // The hook returns data regardless — the Globe VIEW is responsible for
      // checking layer.visible before creating GeoJsonDataSource entities.
      const { result } = renderHook(
        () => ({
          data: useOverlayLayerData("detection-globe-job-1"),
          layer: store.getState().overlay.layers["detection-globe-job-1"]
        }),
        { wrapper: createWrapper(store) }
      );

      // Data is available
      expect(result.current.data).not.toBeNull();
      // But the layer is marked as not visible
      expect(result.current.layer.visible).toBe(false);
    });

    it("view can derive which layers to skip based on visible flag", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      // Two detection layers — one visible, one hidden
      store.dispatch(addLayer(sampleDetectionLayer));
      store.dispatch(
        addLayer({
          ...sampleDetectionLayer,
          id: "detection-globe-job-2",
          name: "Detection: globe-job-2",
          visible: false,
          metadata: { jobId: "globe-job-2", loading: false }
        })
      );

      cache.set("detection-globe-job-1", sampleDetectionData);
      cache.set("detection-globe-job-2", {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [5, 5] },
            properties: {}
          }
        ]
      });

      const state = store.getState().overlay;
      const visibleLayerIds = state.layerOrder.filter(
        (id) => state.layers[id]?.visible
      );

      expect(visibleLayerIds).toContain("detection-globe-job-1");
      expect(visibleLayerIds).not.toContain("detection-globe-job-2");
    });

    it("toggling visibility updates the layer state", () => {
      const store = createTestStore();

      store.dispatch(addLayer(sampleDetectionLayer));
      expect(
        store.getState().overlay.layers["detection-globe-job-1"].visible
      ).toBe(true);

      store.dispatch(
        setLayerVisibility({ layerId: "detection-globe-job-1", visible: false })
      );
      expect(
        store.getState().overlay.layers["detection-globe-job-1"].visible
      ).toBe(false);
    });
  });

  // =========================================================================
  // Test 4: Missing cache entries (null) don't cause errors
  // Validates: Requirements 6.5
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
