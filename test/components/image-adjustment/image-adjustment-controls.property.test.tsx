// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import imageViewerReducer, {
  setAdjustment,
  SetAdjustmentPayload
} from "@/store/slices/image-viewer-slice";
import {
  ADJUSTMENT_CONSTRAINTS,
  clampAdjustment,
  ImageAdjustments
} from "@/utils/image-adjustments";

// Arbitrary generators for valid adjustment values within their ranges
const exposureArb = fc.double({ min: -1, max: 1, noNaN: true });
const contrastArb = fc.double({ min: -1, max: 1, noNaN: true });
const saturationArb = fc.double({ min: -1, max: 1, noNaN: true });
const gammaArb = fc.double({ min: 0.1, max: 3.0, noNaN: true });
const rgbGainArb = fc.double({ min: 0, max: 2, noNaN: true });

// Arbitrary for adjustment keys
const adjustmentKeyArb = fc.constantFrom<keyof ImageAdjustments>(
  "exposure",
  "contrast",
  "saturation",
  "gamma",
  "redGain",
  "greenGain",
  "blueGain"
);

describe("ImageAdjustmentControls - Property-Based Tests", () => {
  /**
   * Feature: image-adjustment-controls, Property 1: Slider-to-State Binding
   * Validates: Requirements 2.1, 3.1, 4.1, 5.1, 6.1
   *
   * Property: For any adjustment slider (exposure, contrast, saturation, gamma,
   * redGain, greenGain, blueGain) and for any valid value within that slider's range,
   * moving the slider SHALL update the corresponding field in currentAdjustments
   * state to match the slider value.
   */
  describe("Property 1: Slider-to-State Binding", () => {
    it("should update exposure state when slider value changes", () => {
      fc.assert(
        fc.property(exposureArb, (value: number) => {
          const initialState = imageViewerReducer(undefined, {
            type: "@@INIT"
          });
          const payload: SetAdjustmentPayload = { key: "exposure", value };
          const newState = imageViewerReducer(
            initialState,
            setAdjustment(payload)
          );

          // Property: State should reflect the slider value (clamped to valid range)
          const expectedValue = clampAdjustment("exposure", value);
          expect(newState.currentAdjustments.exposure).toBeCloseTo(
            expectedValue,
            10
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should update contrast state when slider value changes", () => {
      fc.assert(
        fc.property(contrastArb, (value: number) => {
          const initialState = imageViewerReducer(undefined, {
            type: "@@INIT"
          });
          const payload: SetAdjustmentPayload = { key: "contrast", value };
          const newState = imageViewerReducer(
            initialState,
            setAdjustment(payload)
          );

          const expectedValue = clampAdjustment("contrast", value);
          expect(newState.currentAdjustments.contrast).toBeCloseTo(
            expectedValue,
            10
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should update saturation state when slider value changes", () => {
      fc.assert(
        fc.property(saturationArb, (value: number) => {
          const initialState = imageViewerReducer(undefined, {
            type: "@@INIT"
          });
          const payload: SetAdjustmentPayload = { key: "saturation", value };
          const newState = imageViewerReducer(
            initialState,
            setAdjustment(payload)
          );

          const expectedValue = clampAdjustment("saturation", value);
          expect(newState.currentAdjustments.saturation).toBeCloseTo(
            expectedValue,
            10
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should update gamma state when slider value changes", () => {
      fc.assert(
        fc.property(gammaArb, (value: number) => {
          const initialState = imageViewerReducer(undefined, {
            type: "@@INIT"
          });
          const payload: SetAdjustmentPayload = { key: "gamma", value };
          const newState = imageViewerReducer(
            initialState,
            setAdjustment(payload)
          );

          const expectedValue = clampAdjustment("gamma", value);
          expect(newState.currentAdjustments.gamma).toBeCloseTo(
            expectedValue,
            10
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should update redGain state when slider value changes", () => {
      fc.assert(
        fc.property(rgbGainArb, (value: number) => {
          const initialState = imageViewerReducer(undefined, {
            type: "@@INIT"
          });
          const payload: SetAdjustmentPayload = { key: "redGain", value };
          const newState = imageViewerReducer(
            initialState,
            setAdjustment(payload)
          );

          const expectedValue = clampAdjustment("redGain", value);
          expect(newState.currentAdjustments.redGain).toBeCloseTo(
            expectedValue,
            10
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should update greenGain state when slider value changes", () => {
      fc.assert(
        fc.property(rgbGainArb, (value: number) => {
          const initialState = imageViewerReducer(undefined, {
            type: "@@INIT"
          });
          const payload: SetAdjustmentPayload = { key: "greenGain", value };
          const newState = imageViewerReducer(
            initialState,
            setAdjustment(payload)
          );

          const expectedValue = clampAdjustment("greenGain", value);
          expect(newState.currentAdjustments.greenGain).toBeCloseTo(
            expectedValue,
            10
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should update blueGain state when slider value changes", () => {
      fc.assert(
        fc.property(rgbGainArb, (value: number) => {
          const initialState = imageViewerReducer(undefined, {
            type: "@@INIT"
          });
          const payload: SetAdjustmentPayload = { key: "blueGain", value };
          const newState = imageViewerReducer(
            initialState,
            setAdjustment(payload)
          );

          const expectedValue = clampAdjustment("blueGain", value);
          expect(newState.currentAdjustments.blueGain).toBeCloseTo(
            expectedValue,
            10
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should update any adjustment key with any valid value", () => {
      fc.assert(
        fc.property(adjustmentKeyArb, (key: keyof ImageAdjustments) => {
          // Get the appropriate value arbitrary for this key
          const constraints = ADJUSTMENT_CONSTRAINTS[key];
          const valueArb = fc.double({
            min: constraints.min,
            max: constraints.max,
            noNaN: true
          });

          // Run a nested property test for the value
          fc.assert(
            fc.property(valueArb, (value: number) => {
              const initialState = imageViewerReducer(undefined, {
                type: "@@INIT"
              });
              const payload: SetAdjustmentPayload = { key, value };
              const newState = imageViewerReducer(
                initialState,
                setAdjustment(payload)
              );

              const expectedValue = clampAdjustment(key, value);
              expect(newState.currentAdjustments[key]).toBeCloseTo(
                expectedValue,
                10
              );

              return true;
            }),
            { numRuns: 20 } // Fewer runs for nested test
          );

          return true;
        }),
        { numRuns: 7 } // One run per key
      );
    });

    it("should only update the specified adjustment key, leaving others unchanged", () => {
      fc.assert(
        fc.property(adjustmentKeyArb, (key: keyof ImageAdjustments) => {
          const constraints = ADJUSTMENT_CONSTRAINTS[key];
          const valueArb = fc.double({
            min: constraints.min,
            max: constraints.max,
            noNaN: true
          });

          fc.assert(
            fc.property(valueArb, (value: number) => {
              const initialState = imageViewerReducer(undefined, {
                type: "@@INIT"
              });
              const payload: SetAdjustmentPayload = { key, value };
              const newState = imageViewerReducer(
                initialState,
                setAdjustment(payload)
              );

              // Property: Only the specified key should change
              const allKeys: (keyof ImageAdjustments)[] = [
                "exposure",
                "contrast",
                "saturation",
                "gamma",
                "redGain",
                "greenGain",
                "blueGain"
              ];

              for (const otherKey of allKeys) {
                if (otherKey !== key) {
                  expect(newState.currentAdjustments[otherKey]).toBe(
                    initialState.currentAdjustments[otherKey]
                  );
                }
              }

              return true;
            }),
            { numRuns: 20 }
          );

          return true;
        }),
        { numRuns: 7 }
      );
    });
  });
});
