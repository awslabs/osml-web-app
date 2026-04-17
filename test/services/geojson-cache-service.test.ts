// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for GeoJSONCacheService.
 *
 * Property tests use fast-check with a minimum of 100 iterations.
 * Unit tests cover core CRUD, stats, and subscription behaviour.
 */

import * as fc from "fast-check";
import type { Feature, FeatureCollection } from "geojson";

import { GeoJSONCacheService } from "@/services/geojson-cache-service";

// ---------------------------------------------------------------------------
// Helpers / Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary for a non-empty layer ID string. */
const layerIdArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for a single GeoJSON Feature. */
const featureArb: fc.Arbitrary<Feature> = fc
  .tuple(
    fc.double({ min: -180, max: 180, noNaN: true }),
    fc.double({ min: -90, max: 90, noNaN: true })
  )
  .map(([lon, lat]) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [lon, lat] },
    properties: {}
  }));

/** Arbitrary for a valid GeoJSON FeatureCollection with 0-20 features. */
const featureCollectionArb: fc.Arbitrary<FeatureCollection> = fc
  .array(featureArb, { minLength: 0, maxLength: 20 })
  .map((features) => ({
    type: "FeatureCollection" as const,
    features
  }));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("GeoJSONCacheService", () => {
  beforeEach(() => {
    GeoJSONCacheService.resetInstance();
  });

  // =========================================================================
  // 2.1 — Property 9: Cache set/get round-trip
  // =========================================================================

  /**
   * Property 9: Cache set/get round-trip
   *
   * For any layer ID and valid GeoJSON FeatureCollection, calling
   * `set(layerId, data)` followed by `get(layerId)` SHALL return a
   * FeatureCollection equivalent to `data`, AND `getFeatureCount(layerId)`
   * SHALL equal `data.features.length`.
   *
   * **Validates: Requirements 3.2, 3.3, 3.8**
   */
  describe("Property 9: Cache set/get round-trip", () => {
    it("get returns equivalent data after set, and getFeatureCount matches features.length", () => {
      fc.assert(
        fc.property(layerIdArb, featureCollectionArb, (layerId, data) => {
          const cache = GeoJSONCacheService.getInstance();

          cache.set(layerId, data);

          const retrieved = cache.get(layerId);
          expect(retrieved).not.toBeNull();
          expect(retrieved!.type).toBe("FeatureCollection");
          expect(retrieved!.features).toEqual(data.features);

          expect(cache.getFeatureCount(layerId)).toBe(data.features.length);

          // Reset for next iteration
          cache.clear();
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // 2.2 — Property 7: Cache subscription notification
  // =========================================================================

  /**
   * Property 7: Cache subscription notification
   *
   * For any call to `set(layerId, data)` or `delete(layerId)` where there
   * are N active subscribers for `layerId`, all N subscriber callbacks SHALL
   * be invoked exactly once.
   *
   * **Validates: Requirements 3.6, 9.2, 9.3**
   */
  describe("Property 7: Cache subscription notification", () => {
    it("each subscriber callback is invoked exactly once per set/delete mutation", () => {
      /** Arbitrary for a mutation operation: either "set" or "delete". */
      const mutationArb = fc.oneof(
        featureCollectionArb.map((data) => ({ kind: "set" as const, data })),
        fc.constant({
          kind: "delete" as const,
          data: undefined as unknown as FeatureCollection
        })
      );

      fc.assert(
        fc.property(
          layerIdArb,
          fc.integer({ min: 1, max: 5 }),
          fc.array(mutationArb, { minLength: 1, maxLength: 10 }),
          (layerId, subscriberCount, mutations) => {
            const cache = GeoJSONCacheService.getInstance();

            // Create N subscriber callbacks and track invocation counts
            const counts: number[] = new Array<number>(subscriberCount).fill(0);
            const unsubscribes: (() => void)[] = [];

            for (let i = 0; i < subscriberCount; i++) {
              const unsub = cache.subscribe(layerId, () => {
                counts[i]++;
              });
              unsubscribes.push(unsub);
            }

            // Perform each mutation and verify counts after each one
            for (let m = 0; m < mutations.length; m++) {
              // Reset counts before this mutation
              counts.fill(0);

              const mutation = mutations[m];
              if (mutation.kind === "set") {
                cache.set(layerId, mutation.data);
              } else {
                cache.delete(layerId);
              }

              // Each subscriber should have been called exactly once
              for (let i = 0; i < subscriberCount; i++) {
                expect(counts[i]).toBe(1);
              }
            }

            // Cleanup
            unsubscribes.forEach((unsub) => unsub());
            cache.clear();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // 2.3 — Property 10: Unsubscribe stops notifications
  // =========================================================================

  /**
   * Property 10: Unsubscribe stops notifications
   *
   * For any subscriber that calls the unsubscribe function returned by
   * `subscribe()`, subsequent `set` or `delete` operations on that layer ID
   * SHALL NOT invoke the unsubscribed callback.
   *
   * **Validates: Requirements 3.7, 9.4**
   */
  describe("Property 10: Unsubscribe stops notifications", () => {
    it("unsubscribed callback is not invoked on subsequent mutations", () => {
      fc.assert(
        fc.property(layerIdArb, featureCollectionArb, (layerId, data) => {
          const cache = GeoJSONCacheService.getInstance();

          let callCount = 0;
          const unsubscribe = cache.subscribe(layerId, () => {
            callCount++;
          });

          // Unsubscribe immediately
          unsubscribe();

          // Mutate — callback should NOT fire
          cache.set(layerId, data);
          expect(callCount).toBe(0);

          cache.delete(layerId);
          expect(callCount).toBe(0);

          cache.clear();
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // 2.4 — Property 11: Cache version monotonicity
  // =========================================================================

  /**
   * Property 11: Cache version monotonicity
   *
   * For any sequence of `set` and `delete` operations on a given layer ID,
   * the value returned by `getVersion(layerId)` SHALL be strictly greater
   * after each operation than before it.
   *
   * **Validates: Requirements 3.2, 9.5**
   */
  describe("Property 11: Cache version monotonicity", () => {
    it("getVersion is strictly increasing after each set/delete", () => {
      const mutationArb = fc.oneof(
        featureCollectionArb.map((data) => ({ kind: "set" as const, data })),
        fc.constant({
          kind: "delete" as const,
          data: undefined as unknown as FeatureCollection
        })
      );

      fc.assert(
        fc.property(
          layerIdArb,
          fc.array(mutationArb, { minLength: 1, maxLength: 20 }),
          (layerId, mutations) => {
            const cache = GeoJSONCacheService.getInstance();

            let previousVersion = cache.getVersion(layerId);

            for (const mutation of mutations) {
              if (mutation.kind === "set") {
                cache.set(layerId, mutation.data);
              } else {
                cache.delete(layerId);
              }

              const currentVersion = cache.getVersion(layerId);
              expect(currentVersion).toBeGreaterThan(previousVersion);
              previousVersion = currentVersion;
            }

            cache.clear();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // 2.5 — Unit tests for GeoJSONCacheService
  // =========================================================================

  /**
   * Unit tests covering core CRUD, stats, and subscription behaviour.
   *
   * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 3.9
   */
  describe("Unit tests", () => {
    const sampleCollection: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { name: "A" }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1, 1] },
          properties: { name: "B" }
        }
      ]
    };

    it("set stores data and get retrieves it", () => {
      const cache = GeoJSONCacheService.getInstance();
      cache.set("layer-1", sampleCollection);

      const result = cache.get("layer-1");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("FeatureCollection");
      expect(result!.features).toHaveLength(2);
      expect(result!.features).toEqual(sampleCollection.features);
    });

    it("get returns null for non-existent entry", () => {
      const cache = GeoJSONCacheService.getInstance();
      expect(cache.get("does-not-exist")).toBeNull();
    });

    it("delete removes entry", () => {
      const cache = GeoJSONCacheService.getInstance();
      cache.set("layer-1", sampleCollection);
      expect(cache.has("layer-1")).toBe(true);

      cache.delete("layer-1");
      expect(cache.has("layer-1")).toBe(false);
      expect(cache.get("layer-1")).toBeNull();
    });

    it("clear removes all entries", () => {
      const cache = GeoJSONCacheService.getInstance();
      cache.set("layer-1", sampleCollection);
      cache.set("layer-2", { type: "FeatureCollection", features: [] });

      cache.clear();

      expect(cache.get("layer-1")).toBeNull();
      expect(cache.get("layer-2")).toBeNull();
      expect(cache.getStats().entryCount).toBe(0);
    });

    it("has returns correct boolean", () => {
      const cache = GeoJSONCacheService.getInstance();
      expect(cache.has("layer-1")).toBe(false);

      cache.set("layer-1", sampleCollection);
      expect(cache.has("layer-1")).toBe(true);

      cache.delete("layer-1");
      expect(cache.has("layer-1")).toBe(false);
    });

    it("getStats returns correct entry count and byte size", () => {
      const cache = GeoJSONCacheService.getInstance();

      const emptyStats = cache.getStats();
      expect(emptyStats.entryCount).toBe(0);
      expect(emptyStats.totalByteSize).toBe(0);

      cache.set("layer-1", sampleCollection);
      const stats = cache.getStats();
      expect(stats.entryCount).toBe(1);
      expect(stats.totalByteSize).toBeGreaterThan(0);
    });
  });
});
