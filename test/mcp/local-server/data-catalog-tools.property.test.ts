// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";
import type { StacItem } from "stac-ts";

import {
  SAMPLE_SIZE,
  STAC_BASE_URL,
  transformSearchResponse
} from "@/mcp/local-server/data-catalog-tools";

/** Simplified STAC feature shape for property-based test generation. */
interface TestStacFeature {
  id: string;
  collection: string;
  type: string;
  properties?: Record<string, unknown>;
  bbox?: number[];
  geometry_type?: string;
  [key: string]: unknown;
}

const stacFeatureArb: fc.Arbitrary<TestStacFeature> = fc
  .record({
    id: fc.stringMatching(/^[a-z0-9-]{5,30}$/),
    collection: fc.stringMatching(/^[a-z0-9-]{3,20}$/),
    type: fc.constant("Feature"),
    properties: fc.dictionary(
      fc.stringMatching(/^[a-z_]{2,12}$/),
      fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      { minKeys: 1, maxKeys: 15 }
    ),
    bbox: fc.tuple(
      fc.double({ min: -180, max: 0, noNaN: true }),
      fc.double({ min: -90, max: 0, noNaN: true }),
      fc.double({ min: 0, max: 180, noNaN: true }),
      fc.double({ min: 0, max: 90, noNaN: true })
    ),
    geometry_type: fc.constantFrom("Point", "Polygon", "MultiPolygon")
  })
  .map((r) => ({ ...r, bbox: r.bbox as number[] }));

function stacFeaturesArb(min: number, max: number) {
  return fc
    .array(stacFeatureArb, { minLength: min, maxLength: max })
    .map((features) => features as unknown as StacItem[]);
}

const searchParamsArb = fc.record({
  limit: fc.integer({ min: 1, max: 200 }),
  collections: fc.array(fc.stringMatching(/^[a-z-]{3,15}$/), {
    minLength: 1,
    maxLength: 3
  })
});

describe("Property 1: STAC URL Preservation", () => {
  it("should produce one STAC URL per input feature with correct format", () => {
    fc.assert(
      fc.property(
        stacFeaturesArb(1, 200),
        searchParamsArb,
        (features, params) => {
          const result = transformSearchResponse(
            features,
            features.length,
            params
          );
          expect(result.stac_urls).toHaveLength(features.length);
          result.stac_urls.forEach((url, i) => {
            expect(url).toBe(
              `${STAC_BASE_URL}/collections/${features[i].collection}/items/${features[i].id}`
            );
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 2: Sample Feature Count", () => {
  it("should return min(SAMPLE_SIZE, N) sample features", () => {
    fc.assert(
      fc.property(
        stacFeaturesArb(1, 200),
        searchParamsArb,
        (features, params) => {
          const result = transformSearchResponse(
            features,
            features.length,
            params
          );
          expect(result.sample_features).toHaveLength(
            Math.min(SAMPLE_SIZE, features.length)
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 3: Sample Features Are Complete", () => {
  it("should preserve all original fields and add stac_url", () => {
    fc.assert(
      fc.property(
        stacFeaturesArb(1, 50),
        searchParamsArb,
        (features, params) => {
          const result = transformSearchResponse(
            features,
            features.length,
            params
          );
          for (let i = 0; i < result.sample_features.length; i++) {
            const sample = result.sample_features[i];
            expect(sample.stac_url).toBeDefined();
            for (const key of Object.keys(features[i])) {
              expect(sample[key]).toEqual(
                (features[i] as Record<string, unknown>)[key]
              );
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 4: Response Structural Completeness", () => {
  it("should contain all required fields with correct types", () => {
    fc.assert(
      fc.property(
        stacFeaturesArb(0, 200),
        searchParamsArb,
        fc.integer({ min: 0, max: 500 }),
        (features, params, totalMatched) => {
          const result = transformSearchResponse(
            features,
            totalMatched,
            params
          );
          expect(typeof result.message).toBe("string");
          expect(result.message.length).toBeGreaterThan(0);
          expect(Array.isArray(result.sample_features)).toBe(true);
          expect(Array.isArray(result.stac_urls)).toBe(true);
          expect(typeof result.totalMatched).toBe("number");
          expect(typeof result.returned).toBe("number");
          expect(typeof result.hasMore).toBe("boolean");
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 5: Context Size Reduction", () => {
  const realisticFeatureArb: fc.Arbitrary<TestStacFeature> = fc
    .record({
      id: fc.stringMatching(/^[a-z0-9-]{15,40}$/),
      collection: fc.stringMatching(/^[a-z0-9-]{5,20}$/),
      type: fc.constant("Feature"),
      properties: fc.dictionary(
        fc.stringMatching(/^[a-z_]{4,20}$/),
        fc.oneof(
          fc.string({ minLength: 10, maxLength: 200 }),
          fc.integer(),
          fc.boolean()
        ),
        { minKeys: 10, maxKeys: 30 }
      ),
      bbox: fc.tuple(
        fc.double({ min: -180, max: 0, noNaN: true }),
        fc.double({ min: -90, max: 0, noNaN: true }),
        fc.double({ min: 0, max: 180, noNaN: true }),
        fc.double({ min: 0, max: 90, noNaN: true })
      ),
      geometry_type: fc.constantFrom("Point", "Polygon", "MultiPolygon")
    })
    .map((r) => ({ ...r, bbox: r.bbox as number[] }));

  it("should produce smaller JSON than full-feature response for 10+ realistic features", () => {
    fc.assert(
      fc.property(
        fc.array(realisticFeatureArb, { minLength: 10, maxLength: 200 }),
        searchParamsArb,
        (features, params) => {
          const lightResult = transformSearchResponse(
            features as unknown as StacItem[],
            features.length,
            params
          );
          const fullResult = {
            success: true,
            message: lightResult.message,
            features: features.map((f, i) => ({
              ...f,
              stac_url: lightResult.stac_urls[i]
            })),
            totalMatched: lightResult.totalMatched,
            returned: lightResult.returned,
            hasMore: lightResult.hasMore,
            searchParams: params
          };
          expect(JSON.stringify(lightResult).length).toBeLessThan(
            JSON.stringify(fullResult).length
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
