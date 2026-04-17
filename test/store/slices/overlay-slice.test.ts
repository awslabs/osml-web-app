// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for overlay-slice.
 *
 * Property tests use fast-check with a minimum of 100 iterations.
 * Unit tests cover core reducer behaviour.
 */

import * as fc from "fast-check";

import overlayReducer, {
  addFeature,
  addLayer,
  clearAllFeatures,
  FeatureStyle,
  GeoJSONFeature,
  LayerSource,
  OverlayLayer,
  OverlayState,
  removeFeature,
  removeLayer,
  selectFeature,
  setLayerOrder,
  toggleLayerVisibility,
  updateFeatureStyle,
  updateLayerMetadata
} from "@/store/slices/overlay-slice";

// ---------------------------------------------------------------------------
// Helpers / Arbitraries
// ---------------------------------------------------------------------------

const AGENT_LAYER_ID = "agent-features";

/** Initial (empty) overlay state. */
const emptyState: OverlayState = {
  layers: {},
  layerOrder: [],
  inlineFeatures: {},
  selectedFeatureId: undefined,
  lastUpdatedBy: "initial"
};

/** Object prototype property names that must be excluded from layer IDs. */
const PROTO_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));

/** Arbitrary for a non-empty layer ID string (avoids "agent-features" and JS prototype names). */
const layerIdArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter(
    (s) => s.trim().length > 0 && s !== AGENT_LAYER_ID && !PROTO_KEYS.has(s)
  );

/** Arbitrary for a valid LayerSource. */
const layerSourceArb: fc.Arbitrary<LayerSource> = fc.constantFrom(
  "agent",
  "user",
  "detection",
  "stac-catalog"
);

/** Arbitrary for a valid OverlayLayer. */
const layerArb: fc.Arbitrary<OverlayLayer> = fc.record({
  id: layerIdArb,
  name: fc.string({ minLength: 1, maxLength: 30 }),
  source: layerSourceArb,
  visible: fc.boolean(),
  zIndex: fc.nat({ max: 200 }),
  featureCount: fc.constant(0),
  style: fc.constant(undefined),
  metadata: fc.constant(undefined)
});

/** Arbitrary for a non-empty feature ID. */
const featureIdArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for a hex color string like "#a1b2c3". */
const hexColorArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 6, maxLength: 6 })
  .map((digits) => "#" + digits.map((d) => d.toString(16)).join(""));

/** Arbitrary for a valid FeatureStyle. */
const featureStyleArb: fc.Arbitrary<FeatureStyle> = fc.record(
  {
    color: hexColorArb,
    fillColor: hexColorArb,
    opacity: fc.double({ min: 0, max: 1, noNaN: true }),
    fillOpacity: fc.double({ min: 0, max: 1, noNaN: true }),
    weight: fc.nat({ max: 10 }),
    radius: fc.nat({ max: 50 })
  },
  { requiredKeys: [] }
);

/** Arbitrary for a valid GeoJSONFeature. */
const featureArb: fc.Arbitrary<GeoJSONFeature> = fc.record({
  type: fc.constant("Feature" as const),
  id: featureIdArb,
  geometry: fc.record({
    type: fc.constant("Point" as const),
    coordinates: fc.tuple(
      fc.double({ min: -180, max: 180, noNaN: true }),
      fc.double({ min: -90, max: 90, noNaN: true })
    )
  }),
  properties: fc.record({
    createdBy: fc.constantFrom("agent" as const, "user" as const),
    createdAt: fc
      .integer({ min: 946684800000, max: 1893456000000 })
      .map((ts) => new Date(ts).toISOString()),
    description: fc.option(fc.string({ maxLength: 50 }), { nil: undefined })
  })
});

/** Arbitrary for updatedBy field. */
const updatedByArb = fc.constantFrom("agent" as const, "user" as const);

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("overlay-slice", () => {
  // =========================================================================
  // 6.1 — Property 2: Inline feature count consistency
  // =========================================================================

  /**
   * Property 2: Inline feature count consistency
   *
   * For any random sequence of addFeature / removeFeature actions, the
   * featureCount stored on the "agent-features" layer SHALL always equal
   * the length of inlineFeatures["agent-features"].
   *
   * **Validates: Requirements 2.4, 2.5, 7.1, 7.2**
   */
  describe("Property 2: Inline feature count consistency", () => {
    it("layers['agent-features'].featureCount === inlineFeatures['agent-features'].length after any add/remove sequence", () => {
      const actionArb = fc.oneof(
        fc.record({
          kind: fc.constant("add" as const),
          feature: featureArb,
          updatedBy: updatedByArb
        }),
        fc.record({
          kind: fc.constant("remove" as const),
          featureId: featureIdArb,
          updatedBy: updatedByArb
        })
      );

      fc.assert(
        fc.property(
          fc.array(actionArb, { minLength: 1, maxLength: 30 }),
          (actions) => {
            let state: OverlayState = overlayReducer(undefined, {
              type: "@@INIT"
            });

            for (const action of actions) {
              if (action.kind === "add") {
                state = overlayReducer(
                  state,
                  addFeature({
                    feature: action.feature,
                    updatedBy: action.updatedBy
                  })
                );
              } else {
                state = overlayReducer(
                  state,
                  removeFeature({
                    featureId: action.featureId,
                    updatedBy: action.updatedBy
                  })
                );
              }
            }

            const agentLayer = state.layers[AGENT_LAYER_ID];
            const inlineFeats = state.inlineFeatures[AGENT_LAYER_ID] ?? [];

            // If any addFeature was dispatched, the layer must exist
            if (actions.some((a) => a.kind === "add")) {
              expect(agentLayer).toBeDefined();
              expect(agentLayer.featureCount).toBe(inlineFeats.length);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // 6.2 — Property 3: Layer order integrity
  // =========================================================================

  /**
   * Property 3: Layer order integrity
   *
   * For any random sequence of addLayer / removeLayer / setLayerOrder
   * actions, every ID in layerOrder exists in layers, and every key in
   * layers appears exactly once in layerOrder (bijection).
   *
   * **Validates: Requirements 1.3, 1.5, 1.10**
   */
  describe("Property 3: Layer order integrity", () => {
    it("bijection between layers keys and layerOrder entries after any add/remove/reorder sequence", () => {
      const actionArb = fc.oneof(
        layerArb.map((layer) => ({ kind: "add" as const, layer })),
        layerIdArb.map((id) => ({ kind: "remove" as const, id })),
        fc.array(layerIdArb, { minLength: 0, maxLength: 10 }).map((ids) => ({
          kind: "reorder" as const,
          ids
        }))
      );

      fc.assert(
        fc.property(
          fc.array(actionArb, { minLength: 1, maxLength: 30 }),
          (actions) => {
            let state: OverlayState = overlayReducer(undefined, {
              type: "@@INIT"
            });

            for (const action of actions) {
              if (action.kind === "add") {
                state = overlayReducer(state, addLayer(action.layer));
              } else if (action.kind === "remove") {
                state = overlayReducer(state, removeLayer(action.id));
              } else {
                // setLayerOrder — only pass IDs that actually exist in layers
                const validIds = action.ids.filter((id) => id in state.layers);
                // Include any layer IDs not in the reorder list
                const allLayerIds = Object.keys(state.layers);
                const missingIds = allLayerIds.filter(
                  (id) => !validIds.includes(id)
                );
                state = overlayReducer(
                  state,
                  setLayerOrder([...validIds, ...missingIds])
                );
              }
            }

            const layerKeys = Object.keys(state.layers).sort();
            const orderIds = [...state.layerOrder].sort();

            // Bijection: same elements, no duplicates
            expect(orderIds).toEqual(layerKeys);
            expect(new Set(state.layerOrder).size).toBe(
              state.layerOrder.length
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // 6.3 — Property 4: addFeature convenience action
  // =========================================================================

  /**
   * Property 4: addFeature convenience action
   *
   * For any random GeoJSON feature, after dispatching addFeature the
   * "agent-features" layer SHALL exist, the feature SHALL be present in
   * inlineFeatures, and there SHALL be no duplicate feature IDs.
   *
   * **Validates: Requirements 7.1**
   */
  describe("Property 4: addFeature convenience action", () => {
    it("agent-features layer exists, feature present, no duplicates after addFeature", () => {
      fc.assert(
        fc.property(
          fc.array(featureArb, { minLength: 1, maxLength: 20 }),
          updatedByArb,
          (features, updatedBy) => {
            let state: OverlayState = overlayReducer(undefined, {
              type: "@@INIT"
            });

            for (const feature of features) {
              state = overlayReducer(state, addFeature({ feature, updatedBy }));

              // "agent-features" layer must exist
              expect(state.layers[AGENT_LAYER_ID]).toBeDefined();
              expect(state.layers[AGENT_LAYER_ID].source).toBe("agent");
              expect(state.layerOrder).toContain(AGENT_LAYER_ID);

              // Feature must be present
              const inlineFeats = state.inlineFeatures[AGENT_LAYER_ID] ?? [];
              expect(inlineFeats.some((f) => f.id === feature.id)).toBe(true);

              // No duplicate IDs
              const ids = inlineFeats.map((f) => f.id);
              expect(new Set(ids).size).toBe(ids.length);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // 6.4 — Property 5: removeLayer cleans up all references
  // =========================================================================

  /**
   * Property 5: removeLayer cleans up all references
   *
   * For any random layer additions followed by removals, the removed layer
   * ID SHALL be absent from layers, layerOrder, and inlineFeatures.
   *
   * **Validates: Requirements 1.5, 8.4**
   */
  describe("Property 5: removeLayer cleans up all references", () => {
    it("removed layer ID is absent from layers, layerOrder, and inlineFeatures", () => {
      fc.assert(
        fc.property(
          fc.array(layerArb, { minLength: 1, maxLength: 10 }),
          (layers) => {
            let state: OverlayState = overlayReducer(undefined, {
              type: "@@INIT"
            });

            // Add all layers
            for (const layer of layers) {
              state = overlayReducer(state, addLayer(layer));
            }

            // Remove each layer one by one
            for (const layer of layers) {
              state = overlayReducer(state, removeLayer(layer.id));

              expect(state.layers[layer.id]).toBeUndefined();
              expect(state.layerOrder).not.toContain(layer.id);
              expect(state.inlineFeatures[layer.id]).toBeUndefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // 6.5 — Property 6: Toggle visibility round-trip
  // =========================================================================

  /**
   * Property 6: Toggle visibility round-trip
   *
   * For any layer, toggling visibility twice SHALL return the visible flag
   * to its original value.
   *
   * **Validates: Requirements 1.6, 1.7**
   */
  describe("Property 6: Toggle visibility round-trip", () => {
    it("toggling visibility twice returns to original value", () => {
      fc.assert(
        fc.property(layerArb, (layer) => {
          let state: OverlayState = overlayReducer(undefined, {
            type: "@@INIT"
          });

          // Add the layer
          state = overlayReducer(state, addLayer(layer));
          const originalVisible = state.layers[layer.id]?.visible;

          // Toggle once
          state = overlayReducer(state, toggleLayerVisibility(layer.id));
          expect(state.layers[layer.id]?.visible).toBe(!originalVisible);

          // Toggle again — should be back to original
          state = overlayReducer(state, toggleLayerVisibility(layer.id));
          expect(state.layers[layer.id]?.visible).toBe(originalVisible);
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // 6.6 — Property 12: Style merge preserves existing properties
  // =========================================================================

  /**
   * Property 12: Style merge preserves existing properties
   *
   * For any feature with an existing style and a partial style update,
   * the merged style SHALL contain all original properties not overridden
   * plus all update properties.
   *
   * **Validates: Requirements 2.8, 7.5**
   */
  describe("Property 12: Style merge preserves existing properties", () => {
    it("merged style contains all original properties not overridden plus all update properties", () => {
      fc.assert(
        fc.property(
          featureArb,
          featureStyleArb,
          featureStyleArb,
          updatedByArb,
          (baseFeature, originalStyle, updateStyle, updatedBy) => {
            // Create a feature with the original style
            const featureWithStyle: GeoJSONFeature = {
              ...baseFeature,
              properties: {
                ...baseFeature.properties,
                style: originalStyle
              }
            };

            let state: OverlayState = overlayReducer(undefined, {
              type: "@@INIT"
            });

            // Add the feature
            state = overlayReducer(
              state,
              addFeature({ feature: featureWithStyle, updatedBy })
            );

            // Update the style
            state = overlayReducer(
              state,
              updateFeatureStyle({
                featureId: baseFeature.id,
                style: updateStyle,
                updatedBy
              })
            );

            // Find the feature in state
            const features = state.inlineFeatures[AGENT_LAYER_ID] ?? [];
            const updatedFeature = features.find(
              (f) => f.id === baseFeature.id
            );
            expect(updatedFeature).toBeDefined();

            const mergedStyle = updatedFeature!.properties.style ?? {};

            // All update properties should be present
            for (const [key, value] of Object.entries(updateStyle)) {
              if (value !== undefined) {
                expect(mergedStyle[key as keyof FeatureStyle]).toBe(value);
              }
            }

            // All original properties not overridden should be preserved
            for (const [key, value] of Object.entries(originalStyle)) {
              if (
                value !== undefined &&
                updateStyle[key as keyof FeatureStyle] === undefined
              ) {
                expect(mergedStyle[key as keyof FeatureStyle]).toBe(value);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // 6.7 — Property 8: No large GeoJSON in Redux state
  // =========================================================================

  /**
   * Property 8: No large GeoJSON in Redux state
   *
   * After any sequence of addLayer with source: "detection", the
   * inlineFeatures record SHALL NOT contain entries for detection layer IDs.
   *
   * **Validates: Requirements 2.9, 8.1, 8.2**
   */
  describe("Property 8: No large GeoJSON in Redux state", () => {
    it("inlineFeatures does not contain entries for detection layer IDs", () => {
      const detectionLayerArb: fc.Arbitrary<OverlayLayer> = fc.record({
        id: layerIdArb.map((id) => `detection-${id}`),
        name: fc.string({ minLength: 1, maxLength: 30 }),
        source: fc.constant("detection" as const),
        visible: fc.boolean(),
        zIndex: fc.nat({ max: 200 }),
        featureCount: fc.nat({ max: 1000 }),
        style: fc.constant(undefined),
        metadata: fc.record({
          jobId: fc.string({ minLength: 1, maxLength: 20 }),
          loading: fc.boolean()
        })
      });

      fc.assert(
        fc.property(
          fc.array(detectionLayerArb, { minLength: 1, maxLength: 10 }),
          (detectionLayers) => {
            let state: OverlayState = overlayReducer(undefined, {
              type: "@@INIT"
            });

            for (const layer of detectionLayers) {
              state = overlayReducer(state, addLayer(layer));
            }

            // No detection layer ID should appear in inlineFeatures
            for (const layer of detectionLayers) {
              expect(state.inlineFeatures[layer.id]).toBeUndefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // 6.8 — Unit tests for overlay-slice reducers
  // =========================================================================

  /**
   * Unit tests covering core reducer behaviour.
   *
   * Requirements: 1.1-1.10, 2.1-2.9, 7.1-7.5
   */
  describe("Unit tests", () => {
    const sampleLayer: OverlayLayer = {
      id: "test-layer-1",
      name: "Test Layer",
      source: "detection",
      visible: true,
      zIndex: 10,
      featureCount: 0,
      metadata: { jobId: "job-1", loading: false }
    };

    const sampleFeature: GeoJSONFeature = {
      type: "Feature",
      id: "feat-1",
      geometry: { type: "Point", coordinates: [10, 20] },
      properties: {
        createdBy: "agent",
        createdAt: "2025-01-01T00:00:00.000Z",
        description: "Test feature"
      }
    };

    // --- addLayer ---

    it("addLayer creates layer and appends to layerOrder", () => {
      const state = overlayReducer(emptyState, addLayer(sampleLayer));

      expect(state.layers[sampleLayer.id]).toEqual(sampleLayer);
      expect(state.layerOrder).toContain(sampleLayer.id);
      expect(state.layerOrder).toHaveLength(1);
    });

    it("addLayer with existing ID replaces layer (idempotent)", () => {
      let state = overlayReducer(emptyState, addLayer(sampleLayer));

      const updatedLayer: OverlayLayer = {
        ...sampleLayer,
        name: "Updated Name",
        visible: false
      };
      state = overlayReducer(state, addLayer(updatedLayer));

      expect(state.layers[sampleLayer.id]).toEqual(updatedLayer);
      // Should NOT duplicate in layerOrder
      expect(
        state.layerOrder.filter((id) => id === sampleLayer.id)
      ).toHaveLength(1);
    });

    // --- removeLayer ---

    it("removeLayer removes from layers, layerOrder, and inlineFeatures", () => {
      // Set up state with a layer and some inline features
      let state = overlayReducer(
        emptyState,
        addLayer({
          ...sampleLayer,
          id: "removable",
          source: "agent"
        })
      );
      // Manually add inline features for this layer to verify cleanup
      state = {
        ...state,
        inlineFeatures: {
          ...state.inlineFeatures,
          removable: [sampleFeature]
        }
      };

      state = overlayReducer(state, removeLayer("removable"));

      expect(state.layers["removable"]).toBeUndefined();
      expect(state.layerOrder).not.toContain("removable");
      expect(state.inlineFeatures["removable"]).toBeUndefined();
    });

    // --- addFeature ---

    it("addFeature auto-creates 'agent-features' layer on first call", () => {
      const state = overlayReducer(
        emptyState,
        addFeature({ feature: sampleFeature, updatedBy: "agent" })
      );

      expect(state.layers[AGENT_LAYER_ID]).toBeDefined();
      expect(state.layers[AGENT_LAYER_ID].source).toBe("agent");
      expect(state.layers[AGENT_LAYER_ID].visible).toBe(true);
      expect(state.layers[AGENT_LAYER_ID].zIndex).toBe(100);
      expect(state.layerOrder).toContain(AGENT_LAYER_ID);
      expect(state.inlineFeatures[AGENT_LAYER_ID]).toHaveLength(1);
      expect(state.inlineFeatures[AGENT_LAYER_ID][0]).toEqual(sampleFeature);
    });

    it("addFeature with duplicate ID replaces the feature", () => {
      let state = overlayReducer(
        emptyState,
        addFeature({ feature: sampleFeature, updatedBy: "agent" })
      );

      const updatedFeature: GeoJSONFeature = {
        ...sampleFeature,
        properties: {
          ...sampleFeature.properties,
          description: "Updated description"
        }
      };

      state = overlayReducer(
        state,
        addFeature({ feature: updatedFeature, updatedBy: "agent" })
      );

      const features = state.inlineFeatures[AGENT_LAYER_ID];
      expect(features).toHaveLength(1);
      expect(features[0].properties.description).toBe("Updated description");
    });

    // --- removeFeature ---

    it("removeFeature decrements featureCount", () => {
      let state = overlayReducer(
        emptyState,
        addFeature({ feature: sampleFeature, updatedBy: "agent" })
      );

      const secondFeature: GeoJSONFeature = {
        ...sampleFeature,
        id: "feat-2"
      };
      state = overlayReducer(
        state,
        addFeature({ feature: secondFeature, updatedBy: "agent" })
      );

      expect(state.layers[AGENT_LAYER_ID].featureCount).toBe(2);

      state = overlayReducer(
        state,
        removeFeature({ featureId: "feat-1", updatedBy: "agent" })
      );

      expect(state.layers[AGENT_LAYER_ID].featureCount).toBe(1);
      expect(state.inlineFeatures[AGENT_LAYER_ID]).toHaveLength(1);
      expect(state.inlineFeatures[AGENT_LAYER_ID][0].id).toBe("feat-2");
    });

    // --- clearAllFeatures ---

    it("clearAllFeatures resets inline features and count", () => {
      let state = overlayReducer(
        emptyState,
        addFeature({ feature: sampleFeature, updatedBy: "agent" })
      );
      state = overlayReducer(
        state,
        addFeature({
          feature: { ...sampleFeature, id: "feat-2" },
          updatedBy: "agent"
        })
      );

      expect(state.inlineFeatures[AGENT_LAYER_ID]).toHaveLength(2);

      state = overlayReducer(state, clearAllFeatures({ updatedBy: "agent" }));

      expect(state.inlineFeatures[AGENT_LAYER_ID]).toHaveLength(0);
      expect(state.layers[AGENT_LAYER_ID].featureCount).toBe(0);
    });

    // --- toggleLayerVisibility ---

    it("toggleLayerVisibility flips visible boolean", () => {
      let state = overlayReducer(emptyState, addLayer(sampleLayer));
      expect(state.layers[sampleLayer.id].visible).toBe(true);

      state = overlayReducer(state, toggleLayerVisibility(sampleLayer.id));
      expect(state.layers[sampleLayer.id].visible).toBe(false);

      state = overlayReducer(state, toggleLayerVisibility(sampleLayer.id));
      expect(state.layers[sampleLayer.id].visible).toBe(true);
    });

    // --- setLayerOrder ---

    it("setLayerOrder reorders layers", () => {
      const layer1: OverlayLayer = { ...sampleLayer, id: "layer-a" };
      const layer2: OverlayLayer = { ...sampleLayer, id: "layer-b" };
      const layer3: OverlayLayer = { ...sampleLayer, id: "layer-c" };

      let state = overlayReducer(emptyState, addLayer(layer1));
      state = overlayReducer(state, addLayer(layer2));
      state = overlayReducer(state, addLayer(layer3));

      expect(state.layerOrder).toEqual(["layer-a", "layer-b", "layer-c"]);

      state = overlayReducer(
        state,
        setLayerOrder(["layer-c", "layer-a", "layer-b"])
      );
      expect(state.layerOrder).toEqual(["layer-c", "layer-a", "layer-b"]);
    });

    // --- updateLayerMetadata ---

    it("updateLayerMetadata merges metadata fields", () => {
      let state = overlayReducer(emptyState, addLayer(sampleLayer));

      state = overlayReducer(
        state,
        updateLayerMetadata({
          layerId: sampleLayer.id,
          name: "New Name",
          metadata: {
            jobId: "job-1",
            loading: true,
            error: "Something went wrong"
          }
        })
      );

      expect(state.layers[sampleLayer.id].name).toBe("New Name");
      expect(state.layers[sampleLayer.id].metadata?.loading).toBe(true);
      expect(state.layers[sampleLayer.id].metadata?.error).toBe(
        "Something went wrong"
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: removeLayer/removeFeature selectedFeatureId clearing (lines 95-96, 230)
// ---------------------------------------------------------------------------

import { configureStore } from "@reduxjs/toolkit";

describe("overlay-slice - branch coverage", () => {
  const makeStore = () =>
    configureStore({ reducer: { overlay: overlayReducer } });

  it("removeLayer should clear selectedFeatureId when selected feature belongs to removed layer", () => {
    const store = makeStore();

    store.dispatch(
      addFeature({
        feature: {
          id: "feat-1",
          type: "Feature",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { description: "test" }
        },
        updatedBy: "agent"
      })
    );
    store.dispatch(selectFeature("feat-1"));
    expect(store.getState().overlay.selectedFeatureId).toBe("feat-1");

    store.dispatch(removeLayer("agent-features"));
    expect(store.getState().overlay.selectedFeatureId).toBeUndefined();
  });

  it("removeFeature should clear selectedFeatureId when removed feature was selected", () => {
    const store = makeStore();

    store.dispatch(
      addFeature({
        feature: {
          id: "feat-2",
          type: "Feature",
          geometry: { type: "Point", coordinates: [1, 1] },
          properties: { description: "test2" }
        },
        updatedBy: "agent"
      })
    );
    store.dispatch(selectFeature("feat-2"));
    expect(store.getState().overlay.selectedFeatureId).toBe("feat-2");

    store.dispatch(removeFeature({ featureId: "feat-2", updatedBy: "agent" }));
    expect(store.getState().overlay.selectedFeatureId).toBeUndefined();
  });
});
