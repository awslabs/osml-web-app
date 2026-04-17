// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import {
  ADJUSTMENT_CONSTRAINTS,
  clampAdjustment,
  ImageAdjustments,
  isValidAdjustment
} from "@/store/types";

describe("Image Adjustment Types - Property-Based Tests", () => {
  /**
   * Feature: image-adjustment-controls, Property 10: Adjustment Value Clamping
   * Validates: Requirements 2.3, 3.3, 4.3, 5.3, 6.3
   *
   * Property: For any adjustment key and for any numeric value, the clampAdjustment
   * function SHALL return a value within the valid range for that adjustment type.
   */
  describe("Property 10: Adjustment Value Clamping", () => {
    const adjustmentKeys: (keyof ImageAdjustments)[] = [
      "exposure",
      "contrast",
      "saturation",
      "gamma",
      "redGain",
      "greenGain",
      "blueGain"
    ];

    it("should clamp any numeric value to the valid range for each adjustment type", () => {
      adjustmentKeys.forEach((key) => {
        const constraints = ADJUSTMENT_CONSTRAINTS[key];

        fc.assert(
          fc.property(
            fc.double({ noNaN: true, noDefaultInfinity: true }),
            (value: number) => {
              const clamped = clampAdjustment(key, value);

              // Property: Clamped value is within valid range
              expect(clamped).toBeGreaterThanOrEqual(constraints.min);
              expect(clamped).toBeLessThanOrEqual(constraints.max);

              return true;
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    it("should return the original value if already within range", () => {
      adjustmentKeys.forEach((key) => {
        const constraints = ADJUSTMENT_CONSTRAINTS[key];

        fc.assert(
          fc.property(
            fc.double({
              min: constraints.min,
              max: constraints.max,
              noNaN: true
            }),
            (value: number) => {
              const clamped = clampAdjustment(key, value);

              // Property: Values within range are unchanged
              expect(clamped).toBe(value);

              return true;
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    it("should clamp values below minimum to minimum", () => {
      adjustmentKeys.forEach((key) => {
        const constraints = ADJUSTMENT_CONSTRAINTS[key];

        fc.assert(
          fc.property(
            fc.double({
              max: constraints.min - 0.001,
              noNaN: true,
              noDefaultInfinity: true
            }),
            (value: number) => {
              const clamped = clampAdjustment(key, value);

              // Property: Values below min are clamped to min
              expect(clamped).toBe(constraints.min);

              return true;
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    it("should clamp values above maximum to maximum", () => {
      adjustmentKeys.forEach((key) => {
        const constraints = ADJUSTMENT_CONSTRAINTS[key];

        fc.assert(
          fc.property(
            fc.double({
              min: constraints.max + 0.001,
              noNaN: true,
              noDefaultInfinity: true
            }),
            (value: number) => {
              const clamped = clampAdjustment(key, value);

              // Property: Values above max are clamped to max
              expect(clamped).toBe(constraints.max);

              return true;
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    it("should validate that isValidAdjustment returns true for values within range", () => {
      adjustmentKeys.forEach((key) => {
        const constraints = ADJUSTMENT_CONSTRAINTS[key];

        fc.assert(
          fc.property(
            fc.double({
              min: constraints.min,
              max: constraints.max,
              noNaN: true
            }),
            (value: number) => {
              // Property: Values within range are valid
              expect(isValidAdjustment(key, value)).toBe(true);

              return true;
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    it("should validate that isValidAdjustment returns false for values outside range", () => {
      adjustmentKeys.forEach((key) => {
        const constraints = ADJUSTMENT_CONSTRAINTS[key];

        // Test values below minimum
        fc.assert(
          fc.property(
            fc.double({
              max: constraints.min - 0.001,
              noNaN: true,
              noDefaultInfinity: true
            }),
            (value: number) => {
              // Property: Values below min are invalid
              expect(isValidAdjustment(key, value)).toBe(false);

              return true;
            }
          ),
          { numRuns: 50 }
        );

        // Test values above maximum
        fc.assert(
          fc.property(
            fc.double({
              min: constraints.max + 0.001,
              noNaN: true,
              noDefaultInfinity: true
            }),
            (value: number) => {
              // Property: Values above max are invalid
              expect(isValidAdjustment(key, value)).toBe(false);

              return true;
            }
          ),
          { numRuns: 50 }
        );
      });
    });
  });
});
