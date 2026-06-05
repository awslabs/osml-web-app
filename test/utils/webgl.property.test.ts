// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import { ImageAdjustments } from "@/utils/image-adjustments";
import {
  adjustmentsToStyleVariables,
  WebGLStyleVariables
} from "@/utils/webgl";

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

describe("WebGL Utilities - Property-Based Tests", () => {
  /**
   * Feature: image-adjustment-controls, Property 2: State-to-Layer Propagation
   * Validates: Requirements 1.4, 2.2, 3.2, 4.2, 5.2, 6.2, 7.3, 8.8
   *
   * Property: For any change to the currentAdjustments state, the updateStyleVariables()
   * method SHALL be called on the WebGLTileLayer with an object containing all current
   * adjustment values.
   *
   * This test verifies that the adjustmentsToStyleVariables function correctly transforms
   * ImageAdjustments state into WebGLStyleVariables for use with updateStyleVariables().
   */
  describe("Property 2: State-to-Layer Propagation", () => {
    it("should convert all adjustment values to style variables", () => {
      fc.assert(
        fc.property(adjustmentsArb, (adjustments: ImageAdjustments) => {
          const styleVars: WebGLStyleVariables =
            adjustmentsToStyleVariables(adjustments);

          // Property: All adjustment values should be present in style variables
          expect(styleVars.exposure).toBe(adjustments.exposure);
          expect(styleVars.contrast).toBe(adjustments.contrast);
          expect(styleVars.saturation).toBe(adjustments.saturation);
          expect(styleVars.gamma).toBe(adjustments.gamma);
          expect(styleVars.redGain).toBe(adjustments.redGain);
          expect(styleVars.greenGain).toBe(adjustments.greenGain);
          expect(styleVars.blueGain).toBe(adjustments.blueGain);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should produce style variables with exactly 7 properties", () => {
      fc.assert(
        fc.property(adjustmentsArb, (adjustments: ImageAdjustments) => {
          const styleVars = adjustmentsToStyleVariables(adjustments);

          // Property: Style variables should have exactly 7 properties
          const keys = Object.keys(styleVars);
          expect(keys).toHaveLength(7);
          expect(keys).toContain("exposure");
          expect(keys).toContain("contrast");
          expect(keys).toContain("saturation");
          expect(keys).toContain("gamma");
          expect(keys).toContain("redGain");
          expect(keys).toContain("greenGain");
          expect(keys).toContain("blueGain");

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should preserve numeric precision through conversion", () => {
      fc.assert(
        fc.property(adjustmentsArb, (adjustments: ImageAdjustments) => {
          const styleVars = adjustmentsToStyleVariables(adjustments);

          // Property: Values should be exactly equal (no precision loss)
          expect(styleVars.exposure).toStrictEqual(adjustments.exposure);
          expect(styleVars.contrast).toStrictEqual(adjustments.contrast);
          expect(styleVars.saturation).toStrictEqual(adjustments.saturation);
          expect(styleVars.gamma).toStrictEqual(adjustments.gamma);
          expect(styleVars.redGain).toStrictEqual(adjustments.redGain);
          expect(styleVars.greenGain).toStrictEqual(adjustments.greenGain);
          expect(styleVars.blueGain).toStrictEqual(adjustments.blueGain);

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
