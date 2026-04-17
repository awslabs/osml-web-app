// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";
import type { Feature, FeatureCollection } from "geojson";

import { extractFeatureRecords } from "@/utils/analytics/extract-feature-records";

// ---------------------------------------------------------------------------
// Mock GeoJSONCacheService
// ---------------------------------------------------------------------------

/** Build a mock cache that returns the given map entries. */
function mockCache(entries: Record<string, FeatureCollection>): {
  get(layerId: string): FeatureCollection | null;
} {
  const map = new Map<string, FeatureCollection>(Object.entries(entries));
  return {
    get(layerId: string) {
      return map.get(layerId) ?? null;
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers & Generators
// ---------------------------------------------------------------------------

/** Build a well-formed GeoJSON Feature with properties and geometry. */
function makeFeature(
  id: string | number,
  properties: Record<string, unknown>
): Feature {
  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [0, 0] },
    properties
  };
}

/** Build a FeatureCollection from an array of features. */
function makeCollection(features: Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

/**
 * fast-check arbitrary for a well-formed GeoJSON Feature with random
 * confidence and classification properties.
 */
const featureArb = fc
  .record({
    id: fc.oneof(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.integer({ min: 0, max: 10000 })
    ),
    confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), {
      nil: undefined
    }),
    classification: fc.option(fc.string({ minLength: 1, maxLength: 30 }), {
      nil: undefined
    })
  })
  .map(({ id, confidence, classification }) => {
    const props: Record<string, unknown> = {};
    if (confidence !== undefined) props.confidence = confidence;
    if (classification !== undefined) props.classification = classification;
    return makeFeature(id, props);
  });

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("extractFeatureRecords", () => {
  describe("unit tests", () => {
    it("returns feature records for a cache hit with features", () => {
      const features = [
        makeFeature("f1", { confidence: 0.85, classification: "Building" }),
        makeFeature("f2", { confidence: 0.42, classification: "Vehicle" }),
        makeFeature("f3", { confidence: 0.99 })
      ];
      const cache = mockCache({ "layer-1": makeCollection(features) });

      const result = extractFeatureRecords("layer-1", cache);

      expect(result).toHaveLength(3);

      expect(result[0].featureId).toBe("f1");
      expect(result[0].confidence).toBeCloseTo(0.85);
      expect(result[0].classification).toBe("Building");
      expect(result[0].visible).toBe(true);

      expect(result[1].featureId).toBe("f2");
      expect(result[1].confidence).toBeCloseTo(0.42);
      expect(result[1].classification).toBe("Vehicle");
      expect(result[1].visible).toBe(true);

      expect(result[2].featureId).toBe("f3");
      expect(result[2].confidence).toBeCloseTo(0.99);
      expect(result[2].classification).toBeUndefined();
      expect(result[2].visible).toBe(true);
    });

    it("returns empty array when cache has no entry for the layer ID", () => {
      const cache = mockCache({});

      const result = extractFeatureRecords("nonexistent-layer", cache);

      expect(result).toEqual([]);
    });

    it("returns empty array for an empty FeatureCollection", () => {
      const cache = mockCache({ "layer-empty": makeCollection([]) });

      const result = extractFeatureRecords("layer-empty", cache);

      expect(result).toEqual([]);
    });

    it("skips malformed features missing properties", () => {
      const features: Feature[] = [
        makeFeature("good", { confidence: 0.5 }),
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: null
        }
      ];
      const cache = mockCache({ "layer-malformed": makeCollection(features) });

      const result = extractFeatureRecords("layer-malformed", cache);

      expect(result).toHaveLength(1);
      expect(result[0].featureId).toBe("good");
    });

    it("skips malformed features missing geometry", () => {
      const features: Feature[] = [
        makeFeature("good", { classification: "Tank" }),
        {
          type: "Feature",
          geometry: null as unknown as Feature["geometry"],
          properties: { confidence: 0.8 }
        }
      ];
      const cache = mockCache({ "layer-no-geom": makeCollection(features) });

      const result = extractFeatureRecords("layer-no-geom", cache);

      expect(result).toHaveLength(1);
      expect(result[0].featureId).toBe("good");
    });

    it("sets visible to true for all extracted records", () => {
      const features = [
        makeFeature("a", { confidence: 0.1 }),
        makeFeature("b", { confidence: 0.9 }),
        makeFeature("c", {})
      ];
      const cache = mockCache({ "layer-vis": makeCollection(features) });

      const result = extractFeatureRecords("layer-vis", cache);

      result.forEach((r: { visible: boolean }) => {
        expect(r.visible).toBe(true);
      });
    });

    it("handles features with no confidence or classification", () => {
      const features = [makeFeature("bare", {})];
      const cache = mockCache({ "layer-bare": makeCollection(features) });

      const result = extractFeatureRecords("layer-bare", cache);

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBeUndefined();
      expect(result[0].classification).toBeUndefined();
      expect(result[0].visible).toBe(true);
    });

    it("uses feature id as featureId, stringifying numeric ids", () => {
      const features = [
        makeFeature(42, { confidence: 0.5 }),
        makeFeature("string-id", { confidence: 0.6 })
      ];
      const cache = mockCache({ "layer-ids": makeCollection(features) });

      const result = extractFeatureRecords("layer-ids", cache);

      expect(result[0].featureId).toBe("42");
      expect(result[1].featureId).toBe("string-id");
    });
  });

  // -------------------------------------------------------------------------
  // Property-Based Tests
  // -------------------------------------------------------------------------

  describe("feature extraction record count matches cache", () => {
    it("record count equals the number of features in the cached FeatureCollection", () => {
      const featureArrayArb = fc.array(featureArb, {
        minLength: 0,
        maxLength: 50
      });

      fc.assert(
        fc.property(featureArrayArb, (features) => {
          const cache = mockCache({
            "test-layer": makeCollection(features)
          });

          const result = extractFeatureRecords("test-layer", cache);

          expect(result).toHaveLength(features.length);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it("returns empty array for any layer ID not in the cache", () => {
      const layerIdArb = fc.string({ minLength: 1, maxLength: 30 });

      fc.assert(
        fc.property(layerIdArb, (layerId) => {
          const cache = mockCache({});

          const result = extractFeatureRecords(layerId, cache);

          expect(result).toEqual([]);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("all returned records have visible set to true", () => {
      const featureArrayArb = fc.array(featureArb, {
        minLength: 1,
        maxLength: 30
      });

      fc.assert(
        fc.property(featureArrayArb, (features) => {
          const cache = mockCache({
            "vis-layer": makeCollection(features)
          });

          const result = extractFeatureRecords("vis-layer", cache);

          result.forEach((r: { visible: boolean }) => {
            expect(r.visible).toBe(true);
          });

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
