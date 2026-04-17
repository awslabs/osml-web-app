// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import imageViewerReducer, {
  clearViewpointAdjustments,
  loadViewpointAdjustments,
  resetAdjustments,
  saveViewpointAdjustments,
  setSelectedViewpoint
} from "@/store/slices/image-viewer-slice";
import { DEFAULT_ADJUSTMENTS, ImageAdjustments } from "@/store/types";

// Arbitrary generators for valid adjustment values
const exposureArb = fc.double({ min: -1, max: 1, noNaN: true });
const contrastArb = fc.double({ min: -1, max: 1, noNaN: true });
const saturationArb = fc.double({ min: -1, max: 1, noNaN: true });
const gammaArb = fc.double({ min: 0.1, max: 3.0, noNaN: true });
const rgbGainArb = fc.double({ min: 0, max: 2, noNaN: true });

const adjustmentsArb = fc.record({
  exposure: exposureArb,
  contrast: contrastArb,
  saturation: saturationArb,
  gamma: gammaArb,
  redGain: rgbGainArb,
  greenGain: rgbGainArb,
  blueGain: rgbGainArb
});

// Problematic keys that have special behavior in JavaScript objects
const RESERVED_OBJECT_KEYS = ["__proto__", "constructor", "prototype"];

// Arbitrary for viewpoint IDs - filter out reserved object keys
const viewpointIdArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !RESERVED_OBJECT_KEYS.includes(s));

// Helper to create initial state with custom adjustments
function createStateWithAdjustments(adjustments: ImageAdjustments) {
  const initialState = imageViewerReducer(undefined, { type: "@@INIT" });
  return {
    ...initialState,
    currentAdjustments: { ...adjustments }
  };
}

// Helper to create initial state with saved viewpoint adjustments
function createStateWithSavedAdjustments(
  viewpointId: string,
  adjustments: ImageAdjustments
) {
  const initialState = imageViewerReducer(undefined, { type: "@@INIT" });
  return {
    ...initialState,
    adjustmentsByViewpoint: {
      [viewpointId]: { ...adjustments }
    }
  };
}

describe("Image Viewer Slice - Property-Based Tests", () => {
  /**
   * Feature: image-adjustment-controls, Property 3: Reset Produces Defaults
   * Validates: Requirements 7.2
   *
   * Property: For any initial currentAdjustments state (regardless of current values),
   * dispatching a reset action SHALL result in currentAdjustments being set to
   * DEFAULT_ADJUSTMENTS (exposure: 0, contrast: 0, saturation: 0, gamma: 1.0,
   * redGain: 1.0, greenGain: 1.0, blueGain: 1.0).
   */
  describe("Property 3: Reset Produces Defaults", () => {
    it("should reset any adjustment state to default values", () => {
      fc.assert(
        fc.property(adjustmentsArb, (randomAdjustments: ImageAdjustments) => {
          // Create state with random adjustments
          const stateWithRandomAdjustments =
            createStateWithAdjustments(randomAdjustments);

          // Dispatch reset action
          const newState = imageViewerReducer(
            stateWithRandomAdjustments,
            resetAdjustments()
          );

          // Property: After reset, all adjustments should equal defaults
          expect(newState.currentAdjustments.exposure).toBe(
            DEFAULT_ADJUSTMENTS.exposure
          );
          expect(newState.currentAdjustments.contrast).toBe(
            DEFAULT_ADJUSTMENTS.contrast
          );
          expect(newState.currentAdjustments.saturation).toBe(
            DEFAULT_ADJUSTMENTS.saturation
          );
          expect(newState.currentAdjustments.gamma).toBe(
            DEFAULT_ADJUSTMENTS.gamma
          );
          expect(newState.currentAdjustments.redGain).toBe(
            DEFAULT_ADJUSTMENTS.redGain
          );
          expect(newState.currentAdjustments.greenGain).toBe(
            DEFAULT_ADJUSTMENTS.greenGain
          );
          expect(newState.currentAdjustments.blueGain).toBe(
            DEFAULT_ADJUSTMENTS.blueGain
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should produce exact DEFAULT_ADJUSTMENTS object structure", () => {
      fc.assert(
        fc.property(adjustmentsArb, (randomAdjustments: ImageAdjustments) => {
          const stateWithRandomAdjustments =
            createStateWithAdjustments(randomAdjustments);

          const newState = imageViewerReducer(
            stateWithRandomAdjustments,
            resetAdjustments()
          );

          // Property: Reset state should deeply equal DEFAULT_ADJUSTMENTS
          expect(newState.currentAdjustments).toEqual(DEFAULT_ADJUSTMENTS);

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: image-adjustment-controls, Property 7: Viewpoint Adjustment Round-Trip
   * Validates: Requirements 9.4, 9.5
   *
   * Property: For any viewpoint ID and for any valid ImageAdjustments object,
   * saving the adjustments for that viewpoint and then loading them back
   * SHALL return an equivalent ImageAdjustments object.
   */
  describe("Property 7: Viewpoint Adjustment Round-Trip", () => {
    it("should preserve adjustments through save and load cycle", () => {
      fc.assert(
        fc.property(
          viewpointIdArb,
          adjustmentsArb,
          (viewpointId: string, adjustments: ImageAdjustments) => {
            // Create state with the adjustments as current
            const stateWithAdjustments =
              createStateWithAdjustments(adjustments);

            // Save the adjustments for the viewpoint
            const stateAfterSave = imageViewerReducer(
              stateWithAdjustments,
              saveViewpointAdjustments(viewpointId)
            );

            // Modify current adjustments to something different (defaults)
            const stateWithDefaults = {
              ...stateAfterSave,
              currentAdjustments: { ...DEFAULT_ADJUSTMENTS }
            };

            // Load the saved adjustments back
            const stateAfterLoad = imageViewerReducer(
              stateWithDefaults,
              loadViewpointAdjustments(viewpointId)
            );

            // Property: Loaded adjustments should equal the originally saved adjustments
            expect(stateAfterLoad.currentAdjustments.exposure).toBeCloseTo(
              adjustments.exposure,
              10
            );
            expect(stateAfterLoad.currentAdjustments.contrast).toBeCloseTo(
              adjustments.contrast,
              10
            );
            expect(stateAfterLoad.currentAdjustments.saturation).toBeCloseTo(
              adjustments.saturation,
              10
            );
            expect(stateAfterLoad.currentAdjustments.gamma).toBeCloseTo(
              adjustments.gamma,
              10
            );
            expect(stateAfterLoad.currentAdjustments.redGain).toBeCloseTo(
              adjustments.redGain,
              10
            );
            expect(stateAfterLoad.currentAdjustments.greenGain).toBeCloseTo(
              adjustments.greenGain,
              10
            );
            expect(stateAfterLoad.currentAdjustments.blueGain).toBeCloseTo(
              adjustments.blueGain,
              10
            );

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should load defaults when viewpoint has no saved adjustments", () => {
      fc.assert(
        fc.property(viewpointIdArb, (viewpointId: string) => {
          // Create state with no saved adjustments for this viewpoint
          const initialState = imageViewerReducer(undefined, {
            type: "@@INIT"
          });

          // Load adjustments for a viewpoint that has none saved
          const stateAfterLoad = imageViewerReducer(
            initialState,
            loadViewpointAdjustments(viewpointId)
          );

          // Property: Should load default adjustments
          expect(stateAfterLoad.currentAdjustments).toEqual(
            DEFAULT_ADJUSTMENTS
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: image-adjustment-controls, Property 9: Viewpoint Deletion Cleanup
   * Validates: Requirements 9.8
   *
   * Property: For any viewpoint ID that has saved adjustments in adjustmentsByViewpoint,
   * clearing that viewpoint's adjustments SHALL remove its entry from adjustmentsByViewpoint.
   */
  describe("Property 9: Viewpoint Deletion Cleanup", () => {
    it("should remove saved adjustments when viewpoint adjustments are cleared", () => {
      fc.assert(
        fc.property(
          viewpointIdArb,
          adjustmentsArb,
          (viewpointId: string, adjustments: ImageAdjustments) => {
            // Create state with saved adjustments for the viewpoint
            const stateWithSaved = createStateWithSavedAdjustments(
              viewpointId,
              adjustments
            );

            // Verify the adjustments exist before clearing (use Object.hasOwn to avoid prototype issues)
            expect(
              Object.hasOwn(stateWithSaved.adjustmentsByViewpoint, viewpointId)
            ).toBe(true);

            // Clear the viewpoint adjustments
            const stateAfterClear = imageViewerReducer(
              stateWithSaved,
              clearViewpointAdjustments(viewpointId)
            );

            // Property: The viewpoint's adjustments should be removed (use Object.hasOwn)
            expect(
              Object.hasOwn(stateAfterClear.adjustmentsByViewpoint, viewpointId)
            ).toBe(false);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should not affect other viewpoints when clearing one viewpoint's adjustments", () => {
      fc.assert(
        fc.property(
          viewpointIdArb,
          viewpointIdArb,
          adjustmentsArb,
          adjustmentsArb,
          (
            viewpointId1: string,
            viewpointId2: string,
            adjustments1: ImageAdjustments,
            adjustments2: ImageAdjustments
          ) => {
            // Skip if viewpoint IDs are the same
            if (viewpointId1 === viewpointId2) {
              return true;
            }

            // Create state with saved adjustments for both viewpoints
            const initialState = imageViewerReducer(undefined, {
              type: "@@INIT"
            });
            const stateWithBoth = {
              ...initialState,
              adjustmentsByViewpoint: {
                [viewpointId1]: { ...adjustments1 },
                [viewpointId2]: { ...adjustments2 }
              }
            };

            // Clear only the first viewpoint's adjustments
            const stateAfterClear = imageViewerReducer(
              stateWithBoth,
              clearViewpointAdjustments(viewpointId1)
            );

            // Property: First viewpoint's adjustments should be removed (use Object.hasOwn)
            expect(
              Object.hasOwn(
                stateAfterClear.adjustmentsByViewpoint,
                viewpointId1
              )
            ).toBe(false);

            // Property: Second viewpoint's adjustments should remain unchanged
            // Use Object.hasOwn to check existence, then compare values
            expect(
              Object.hasOwn(
                stateAfterClear.adjustmentsByViewpoint,
                viewpointId2
              )
            ).toBe(true);
            expect(
              stateAfterClear.adjustmentsByViewpoint[viewpointId2]
            ).toEqual(adjustments2);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: image-adjustment-controls, Property 8: Pan/Zoom State Persistence
   * Validates: Requirements 9.1
   *
   * Property: For any pan or zoom operation on the map, the currentAdjustments
   * state SHALL remain unchanged before and after the operation.
   *
   * Note: Since pan/zoom operations are handled by OpenLayers and don't dispatch
   * Redux actions that modify currentAdjustments, this property tests that
   * unrelated actions (like setSelectedViewpoint) don't affect currentAdjustments.
   */
  describe("Property 8: Pan/Zoom State Persistence", () => {
    it("should preserve currentAdjustments when setSelectedViewpoint is dispatched", () => {
      fc.assert(
        fc.property(
          adjustmentsArb,
          viewpointIdArb,
          (adjustments: ImageAdjustments, viewpointId: string) => {
            // Create state with custom adjustments
            const stateWithAdjustments =
              createStateWithAdjustments(adjustments);

            // Dispatch setSelectedViewpoint (simulates selecting a viewpoint during pan/zoom)
            const stateAfterSelect = imageViewerReducer(
              stateWithAdjustments,
              setSelectedViewpoint({
                viewpointId: viewpointId,
                viewpointTileSize: 256
              })
            );

            // Property: currentAdjustments should remain unchanged
            expect(stateAfterSelect.currentAdjustments.exposure).toBeCloseTo(
              adjustments.exposure,
              10
            );
            expect(stateAfterSelect.currentAdjustments.contrast).toBeCloseTo(
              adjustments.contrast,
              10
            );
            expect(stateAfterSelect.currentAdjustments.saturation).toBeCloseTo(
              adjustments.saturation,
              10
            );
            expect(stateAfterSelect.currentAdjustments.gamma).toBeCloseTo(
              adjustments.gamma,
              10
            );
            expect(stateAfterSelect.currentAdjustments.redGain).toBeCloseTo(
              adjustments.redGain,
              10
            );
            expect(stateAfterSelect.currentAdjustments.greenGain).toBeCloseTo(
              adjustments.greenGain,
              10
            );
            expect(stateAfterSelect.currentAdjustments.blueGain).toBeCloseTo(
              adjustments.blueGain,
              10
            );

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should preserve currentAdjustments when setSelectedViewpoint is set to null", () => {
      fc.assert(
        fc.property(adjustmentsArb, (adjustments: ImageAdjustments) => {
          // Create state with custom adjustments
          const stateWithAdjustments = createStateWithAdjustments(adjustments);

          // Dispatch setSelectedViewpoint with null (simulates deselecting viewpoint)
          const stateAfterDeselect = imageViewerReducer(
            stateWithAdjustments,
            setSelectedViewpoint(null)
          );

          // Property: currentAdjustments should remain unchanged
          expect(stateAfterDeselect.currentAdjustments.exposure).toBeCloseTo(
            adjustments.exposure,
            10
          );
          expect(stateAfterDeselect.currentAdjustments.contrast).toBeCloseTo(
            adjustments.contrast,
            10
          );
          expect(stateAfterDeselect.currentAdjustments.saturation).toBeCloseTo(
            adjustments.saturation,
            10
          );
          expect(stateAfterDeselect.currentAdjustments.gamma).toBeCloseTo(
            adjustments.gamma,
            10
          );
          expect(stateAfterDeselect.currentAdjustments.redGain).toBeCloseTo(
            adjustments.redGain,
            10
          );
          expect(stateAfterDeselect.currentAdjustments.greenGain).toBeCloseTo(
            adjustments.greenGain,
            10
          );
          expect(stateAfterDeselect.currentAdjustments.blueGain).toBeCloseTo(
            adjustments.blueGain,
            10
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should preserve currentAdjustments through multiple unrelated actions", () => {
      fc.assert(
        fc.property(
          adjustmentsArb,
          viewpointIdArb,
          viewpointIdArb,
          (
            adjustments: ImageAdjustments,
            viewpointId1: string,
            viewpointId2: string
          ) => {
            // Create state with custom adjustments
            const stateWithAdjustments =
              createStateWithAdjustments(adjustments);

            // Dispatch multiple setSelectedViewpoint actions (simulates user interactions)
            let currentState = stateWithAdjustments;

            currentState = imageViewerReducer(
              currentState,
              setSelectedViewpoint({
                viewpointId: viewpointId1,
                viewpointTileSize: 256
              })
            );

            currentState = imageViewerReducer(
              currentState,
              setSelectedViewpoint({
                viewpointId: viewpointId2,
                viewpointTileSize: 512
              })
            );

            currentState = imageViewerReducer(
              currentState,
              setSelectedViewpoint(null)
            );

            // Property: currentAdjustments should remain unchanged through all actions
            expect(currentState.currentAdjustments.exposure).toBeCloseTo(
              adjustments.exposure,
              10
            );
            expect(currentState.currentAdjustments.contrast).toBeCloseTo(
              adjustments.contrast,
              10
            );
            expect(currentState.currentAdjustments.saturation).toBeCloseTo(
              adjustments.saturation,
              10
            );
            expect(currentState.currentAdjustments.gamma).toBeCloseTo(
              adjustments.gamma,
              10
            );
            expect(currentState.currentAdjustments.redGain).toBeCloseTo(
              adjustments.redGain,
              10
            );
            expect(currentState.currentAdjustments.greenGain).toBeCloseTo(
              adjustments.greenGain,
              10
            );
            expect(currentState.currentAdjustments.blueGain).toBeCloseTo(
              adjustments.blueGain,
              10
            );

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
