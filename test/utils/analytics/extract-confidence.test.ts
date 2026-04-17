// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import { extractConfidence } from "@/utils/analytics/extract-confidence";

// ---------------------------------------------------------------------------
// Helpers & Generators
// ---------------------------------------------------------------------------

/** Confidence-like key names split into explicit vs generic groups. */
const EXPLICIT_KEYS = ["confidence", "conf", "probability", "prob"];
const GENERIC_KEYS = ["score"];
const ALL_CONF_KEYS = [...EXPLICIT_KEYS, ...GENERIC_KEYS];

/** Arbitrary that picks a random explicit confidence key (various casings). */
const explicitKeyArb = fc.oneof(
  fc.constant("confidence"),
  fc.constant("Confidence"),
  fc.constant("CONFIDENCE"),
  fc.constant("conf"),
  fc.constant("Conf"),
  fc.constant("probability"),
  fc.constant("Probability"),
  fc.constant("prob"),
  fc.constant("PROB")
);

/** Arbitrary confidence value in the raw [0, 100] range. */
const rawConfidenceArb = fc.double({ min: 0, max: 100, noNaN: true });

/** Arbitrary confidence value already in [0, 1]. */
const normalizedConfidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

/**
 * Build a nested property object that places a confidence value at a random
 * depth (0 = top-level, up to `maxDepth`).
 */
function buildNestedProps(
  key: string,
  value: unknown,
  depth: number
): Record<string, unknown> {
  if (depth === 0) {
    return { [key]: value };
  }
  return { nested: buildNestedProps(key, value, depth - 1) };
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("extractConfidence", () => {
  describe("unit tests", () => {
    it("returns undefined for empty properties", () => {
      expect(extractConfidence({})).toBeUndefined();
    });

    it("returns 0 for confidence = 0 (boundary)", () => {
      expect(extractConfidence({ confidence: 0 })).toBe(0);
    });

    it("returns 1 for confidence = 1 (boundary)", () => {
      expect(extractConfidence({ confidence: 1 })).toBe(1);
    });

    it("normalizes confidence = 100 to 1 (boundary)", () => {
      expect(extractConfidence({ confidence: 100 })).toBe(1);
    });

    it("normalizes confidence = 85 to 0.85", () => {
      expect(extractConfidence({ confidence: 85 })).toBeCloseTo(0.85);
    });

    it("returns value unchanged when in [0, 1]", () => {
      expect(extractConfidence({ confidence: 0.42 })).toBeCloseTo(0.42);
    });

    it("finds a confidence key at depth 4 (maximum searchable depth)", () => {
      const props = buildNestedProps("confidence", 0.75, 3); // depth 3 nesting = 4 levels
      expect(extractConfidence(props)).toBeCloseTo(0.75);
    });

    it("returns undefined for a confidence key at depth 5 (beyond limit)", () => {
      const props = buildNestedProps("confidence", 0.75, 4); // depth 4 nesting = 5 levels
      expect(extractConfidence(props)).toBeUndefined();
    });

    it("handles case-insensitive key matching", () => {
      expect(extractConfidence({ CONFIDENCE: 0.9 })).toBeCloseTo(0.9);
      expect(extractConfidence({ Prob: 0.5 })).toBeCloseTo(0.5);
      expect(extractConfidence({ Score: 0.3 })).toBeCloseTo(0.3);
    });

    it("skips non-numeric values", () => {
      expect(extractConfidence({ confidence: "high" })).toBeUndefined();
      expect(extractConfidence({ confidence: null })).toBeUndefined();
      expect(extractConfidence({ confidence: true })).toBeUndefined();
      expect(extractConfidence({ confidence: undefined })).toBeUndefined();
    });

    it("skips NaN values", () => {
      expect(extractConfidence({ confidence: NaN })).toBeUndefined();
    });

    it("skips negative values", () => {
      expect(extractConfidence({ confidence: -1 })).toBeUndefined();
    });

    it("skips values greater than 100", () => {
      expect(extractConfidence({ confidence: 101 })).toBeUndefined();
    });

    it("prefers explicit keys over score", () => {
      expect(extractConfidence({ score: 0.9, confidence: 0.5 })).toBeCloseTo(
        0.5
      );
    });

    it("returns max among multiple explicit keys", () => {
      expect(
        extractConfidence({ confidence: 0.3, probability: 0.8 })
      ).toBeCloseTo(0.8);
    });

    it("falls back to score when no explicit keys exist", () => {
      expect(extractConfidence({ score: 0.6 })).toBeCloseTo(0.6);
    });

    it("handles mixed key types across nesting levels", () => {
      const props = {
        score: 0.9,
        details: {
          confidence: 0.7
        }
      };
      // Explicit key (confidence) should win over generic (score)
      expect(extractConfidence(props)).toBeCloseTo(0.7);
    });

    it("handles properties with non-confidence keys", () => {
      expect(
        extractConfidence({ name: "building", area: 42, color: "red" })
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Property-Based Tests
  // -------------------------------------------------------------------------

  describe("confidence extraction normalizes to [0, 1]", () => {
    /**
     * For any nested property object with a confidence value in [0, 100]
     * at a random depth (≤ 4), extractConfidence returns a number in [0, 1]
     * or undefined.
     */
    it("always returns a value in [0, 1] or undefined", () => {
      const depthArb = fc.integer({ min: 0, max: 3 }); // 0..3 nesting = depth 1..4
      const keyArb = fc.oneof(...ALL_CONF_KEYS.map(fc.constant));

      fc.assert(
        fc.property(keyArb, rawConfidenceArb, depthArb, (key, value, depth) => {
          const props = buildNestedProps(key, value, depth);
          const result = extractConfidence(props);

          if (result !== undefined) {
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(1);
          }

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it("values in [0, 1] are returned unchanged", () => {
      const keyArb = fc.oneof(...ALL_CONF_KEYS.map(fc.constant));

      fc.assert(
        fc.property(keyArb, normalizedConfidenceArb, (key, value) => {
          const props = { [key]: value };
          const result = extractConfidence(props);

          expect(result).toBeCloseTo(value, 10);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it("values in (1, 100] are divided by 100", () => {
      const keyArb = fc.oneof(...ALL_CONF_KEYS.map(fc.constant));
      const overOneArb = fc.double({ min: 1.001, max: 100, noNaN: true });

      fc.assert(
        fc.property(keyArb, overOneArb, (key, value) => {
          const props = { [key]: value };
          const result = extractConfidence(props);

          expect(result).toBeCloseTo(value / 100, 10);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it("returns undefined when no confidence key exists at searchable depth", () => {
      // Place a confidence key at depth 5 (beyond the 4-level limit)
      const keyArb = fc.oneof(...ALL_CONF_KEYS.map(fc.constant));

      fc.assert(
        fc.property(keyArb, rawConfidenceArb, (key, value) => {
          const props = buildNestedProps(key, value, 4); // depth 5
          const result = extractConfidence(props);

          expect(result).toBeUndefined();

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("confidence extraction prefers explicit keys over score", () => {
    /**
     * For any property object with both an explicit confidence key and a
     * generic score key, extractConfidence returns the normalized value of
     * the explicit key (or the max among multiple explicit keys), regardless
     * of the score value.
     */
    it("explicit key value wins over score value", () => {
      fc.assert(
        fc.property(
          explicitKeyArb,
          normalizedConfidenceArb,
          normalizedConfidenceArb,
          (explicitKey, explicitValue, scoreValue) => {
            const props = {
              [explicitKey]: explicitValue,
              score: scoreValue
            };
            const result = extractConfidence(props);

            // The result should equal the explicit key's value, not score
            expect(result).toBeCloseTo(explicitValue, 10);

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("max of multiple explicit keys wins over score", () => {
      fc.assert(
        fc.property(
          normalizedConfidenceArb,
          normalizedConfidenceArb,
          normalizedConfidenceArb,
          (confValue, probValue, scoreValue) => {
            const props = {
              confidence: confValue,
              probability: probValue,
              score: scoreValue
            };
            const result = extractConfidence(props);
            const expectedMax = Math.max(confValue, probValue);

            expect(result).toBeCloseTo(expectedMax, 10);

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
