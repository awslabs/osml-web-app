// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import { computeLayerStats } from "@/utils/analytics/compute-layer-stats";
import { FeatureRecord } from "@/utils/analytics/types";

// ---------------------------------------------------------------------------
// Helpers & Generators
// ---------------------------------------------------------------------------

/** Build a FeatureRecord with the given values. */
function makeRecord(
  confidence: number | undefined,
  classification: string | undefined,
  featureId?: string
): FeatureRecord {
  return {
    featureId: featureId ?? `feat-${Math.random().toString(36).slice(2, 8)}`,
    confidence,
    classification,
    visible: true
  };
}

/** Arbitrary that generates a valid FeatureRecord. */
const featureRecordArb = fc.record({
  featureId: fc.string({ minLength: 1, maxLength: 20 }),
  confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), {
    nil: undefined
  }),
  classification: fc.option(
    fc.oneof(
      fc.constant("building"),
      fc.constant("vehicle"),
      fc.constant("road"),
      fc.constant("tree"),
      fc.string({ minLength: 1, maxLength: 15 })
    ),
    { nil: undefined }
  ),
  visible: fc.constant(true)
});

/** Arbitrary for a confidence threshold in [0, 1]. */
const thresholdArb = fc.double({ min: 0, max: 1, noNaN: true });

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("computeLayerStats", () => {
  describe("unit tests", () => {
    it("returns zeroed stats for an empty input array", () => {
      const stats = computeLayerStats([], 0);

      expect(stats.totalCount).toBe(0);
      expect(stats.visibleCount).toBe(0);
      expect(stats.confidenceHistogram).toEqual(new Array(10).fill(0));
      expect(stats.avgConfidence).toBeUndefined();
      expect(stats.unknownConfidenceCount).toBe(0);
      expect(stats.unclassifiedCount).toBe(0);
      expect(stats.classificationCounts).toEqual({});
    });

    it("counts all features as visible and unknown when all confidences are undefined", () => {
      const records: FeatureRecord[] = [
        makeRecord(undefined, "building"),
        makeRecord(undefined, "vehicle"),
        makeRecord(undefined, undefined)
      ];
      const stats = computeLayerStats(records, 0.5);

      expect(stats.totalCount).toBe(3);
      // undefined confidence is treated as visible
      expect(stats.visibleCount).toBe(3);
      expect(stats.unknownConfidenceCount).toBe(3);
      expect(stats.avgConfidence).toBeUndefined();
      expect(stats.confidenceHistogram).toEqual(new Array(10).fill(0));
    });

    it("computes correct stats for a single feature with defined confidence", () => {
      const records: FeatureRecord[] = [makeRecord(0.75, "building")];
      const stats = computeLayerStats(records, 0);

      expect(stats.totalCount).toBe(1);
      expect(stats.visibleCount).toBe(1);
      expect(stats.avgConfidence).toBeCloseTo(0.75);
      expect(stats.unknownConfidenceCount).toBe(0);
      expect(stats.unclassifiedCount).toBe(0);
      expect(stats.classificationCounts).toEqual({ building: 1 });
      // 0.75 → bin 7 ([0.7, 0.8))
      expect(stats.confidenceHistogram[7]).toBe(1);
    });

    it("computes correct stats for a single feature with undefined classification", () => {
      const records: FeatureRecord[] = [makeRecord(0.5, undefined)];
      const stats = computeLayerStats(records, 0);

      expect(stats.totalCount).toBe(1);
      expect(stats.unclassifiedCount).toBe(1);
      expect(stats.classificationCounts).toEqual({});
    });

    it("filters features below the confidence threshold", () => {
      const records: FeatureRecord[] = [
        makeRecord(0.3, "building"),
        makeRecord(0.7, "vehicle"),
        makeRecord(0.9, "road")
      ];
      const stats = computeLayerStats(records, 0.5);

      expect(stats.totalCount).toBe(3);
      // Only 0.7 and 0.9 are >= 0.5
      expect(stats.visibleCount).toBe(2);
    });

    it("treats undefined confidence as visible regardless of threshold", () => {
      const records: FeatureRecord[] = [
        makeRecord(undefined, "building"),
        makeRecord(0.2, "vehicle")
      ];
      const stats = computeLayerStats(records, 0.5);

      // undefined → visible, 0.2 < 0.5 → not visible
      expect(stats.visibleCount).toBe(1);
    });

    it("places confidence 0.0 in bin 0", () => {
      const records: FeatureRecord[] = [makeRecord(0.0, undefined)];
      const stats = computeLayerStats(records, 0);

      expect(stats.confidenceHistogram[0]).toBe(1);
    });

    it("places confidence 1.0 in bin 9 (inclusive upper bound)", () => {
      const records: FeatureRecord[] = [makeRecord(1.0, undefined)];
      const stats = computeLayerStats(records, 0);

      expect(stats.confidenceHistogram[9]).toBe(1);
    });

    it("places confidence 0.9 in bin 9", () => {
      const records: FeatureRecord[] = [makeRecord(0.9, undefined)];
      const stats = computeLayerStats(records, 0);

      expect(stats.confidenceHistogram[9]).toBe(1);
    });

    it("places confidence 0.1 in bin 1", () => {
      const records: FeatureRecord[] = [makeRecord(0.1, undefined)];
      const stats = computeLayerStats(records, 0);

      expect(stats.confidenceHistogram[1]).toBe(1);
    });

    it("computes average confidence only from defined values", () => {
      const records: FeatureRecord[] = [
        makeRecord(0.4, undefined),
        makeRecord(undefined, undefined),
        makeRecord(0.8, undefined)
      ];
      const stats = computeLayerStats(records, 0);

      expect(stats.avgConfidence).toBeCloseTo(0.6);
    });

    it("counts classifications correctly across multiple features", () => {
      const records: FeatureRecord[] = [
        makeRecord(0.5, "building"),
        makeRecord(0.6, "building"),
        makeRecord(0.7, "vehicle"),
        makeRecord(0.8, undefined)
      ];
      const stats = computeLayerStats(records, 0);

      expect(stats.classificationCounts).toEqual({
        building: 2,
        vehicle: 1
      });
      expect(stats.unclassifiedCount).toBe(1);
    });

    it("all features visible when threshold is 0", () => {
      const records: FeatureRecord[] = [
        makeRecord(0.01, "a"),
        makeRecord(0.5, "b"),
        makeRecord(0.99, "c"),
        makeRecord(undefined, "d")
      ];
      const stats = computeLayerStats(records, 0);

      expect(stats.visibleCount).toBe(4);
    });

    it("only undefined-confidence features visible when threshold is 1", () => {
      const records: FeatureRecord[] = [
        makeRecord(0.99, "a"),
        makeRecord(undefined, "b"),
        makeRecord(1.0, "c")
      ];
      const stats = computeLayerStats(records, 1);

      // 0.99 < 1.0 → not visible, undefined → visible, 1.0 >= 1.0 → visible
      expect(stats.visibleCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Property-Based Tests
  // -------------------------------------------------------------------------

  describe("layer stats consistency invariants", () => {
    it("totalCount equals input array length", () => {
      fc.assert(
        fc.property(
          fc.array(featureRecordArb, { minLength: 0, maxLength: 50 }),
          thresholdArb,
          (records, threshold) => {
            const stats = computeLayerStats(records, threshold);
            expect(stats.totalCount).toBe(records.length);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("histogram bins + unknownConfidenceCount equals totalCount", () => {
      fc.assert(
        fc.property(
          fc.array(featureRecordArb, { minLength: 0, maxLength: 50 }),
          thresholdArb,
          (records, threshold) => {
            const stats = computeLayerStats(records, threshold);
            const histogramSum = stats.confidenceHistogram.reduce(
              (sum: number, bin: number) => sum + bin,
              0
            );
            expect(histogramSum + stats.unknownConfidenceCount).toBe(
              stats.totalCount
            );
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("classificationCounts + unclassifiedCount equals totalCount", () => {
      fc.assert(
        fc.property(
          fc.array(featureRecordArb, { minLength: 0, maxLength: 50 }),
          thresholdArb,
          (records, threshold) => {
            const stats = computeLayerStats(records, threshold);
            const classifiedSum = (
              Object.values(stats.classificationCounts) as number[]
            ).reduce((sum: number, count: number) => sum + count, 0);
            expect(classifiedSum + stats.unclassifiedCount).toBe(
              stats.totalCount
            );
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("avgConfidence is the arithmetic mean of defined confidence values or undefined", () => {
      fc.assert(
        fc.property(
          fc.array(featureRecordArb, { minLength: 0, maxLength: 50 }),
          thresholdArb,
          (records, threshold) => {
            const stats = computeLayerStats(records, threshold);
            const definedConfs = records
              .map((r) => r.confidence)
              .filter((c): c is number => c !== undefined);

            if (definedConfs.length === 0) {
              expect(stats.avgConfidence).toBeUndefined();
            } else {
              const expectedAvg =
                definedConfs.reduce((sum, c) => sum + c, 0) /
                definedConfs.length;
              expect(stats.avgConfidence).toBeCloseTo(expectedAvg, 10);
            }
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("visibleCount equals features with confidence >= threshold or undefined confidence", () => {
      fc.assert(
        fc.property(
          fc.array(featureRecordArb, { minLength: 0, maxLength: 50 }),
          thresholdArb,
          (records, threshold) => {
            const stats = computeLayerStats(records, threshold);
            const expectedVisible = records.filter(
              (r) => r.confidence === undefined || r.confidence >= threshold
            ).length;
            expect(stats.visibleCount).toBe(expectedVisible);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe("confidence histogram bin assignment", () => {
    it("places each confidence value in the correct bin", () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true }),
          (confidence) => {
            const records: FeatureRecord[] = [
              {
                featureId: "test",
                confidence,
                classification: undefined,
                visible: true
              }
            ];
            const stats = computeLayerStats(records, 0);

            const expectedBin = Math.min(Math.floor(confidence * 10), 9);
            expect(stats.confidenceHistogram[expectedBin]).toBe(1);

            // All other bins should be 0
            const totalInHistogram = stats.confidenceHistogram.reduce(
              (sum: number, bin: number) => sum + bin,
              0
            );
            expect(totalInHistogram).toBe(1);

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("histogram always has exactly 10 bins", () => {
      fc.assert(
        fc.property(
          fc.array(featureRecordArb, { minLength: 0, maxLength: 30 }),
          thresholdArb,
          (records, threshold) => {
            const stats = computeLayerStats(records, threshold);
            expect(stats.confidenceHistogram).toHaveLength(10);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("confidence threshold filters visible features", () => {
    it("visibleCount matches manual count of features above threshold", () => {
      fc.assert(
        fc.property(
          fc.array(featureRecordArb, { minLength: 1, maxLength: 50 }),
          thresholdArb,
          (records, threshold) => {
            const stats = computeLayerStats(records, threshold);

            const manualVisible = records.filter(
              (r) => r.confidence === undefined || r.confidence >= threshold
            ).length;

            expect(stats.visibleCount).toBe(manualVisible);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("visibleCount is always <= totalCount", () => {
      fc.assert(
        fc.property(
          fc.array(featureRecordArb, { minLength: 0, maxLength: 50 }),
          thresholdArb,
          (records, threshold) => {
            const stats = computeLayerStats(records, threshold);
            expect(stats.visibleCount).toBeLessThanOrEqual(stats.totalCount);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("threshold 0 makes all features visible", () => {
      fc.assert(
        fc.property(
          fc.array(featureRecordArb, { minLength: 0, maxLength: 50 }),
          (records) => {
            const stats = computeLayerStats(records, 0);
            expect(stats.visibleCount).toBe(stats.totalCount);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
