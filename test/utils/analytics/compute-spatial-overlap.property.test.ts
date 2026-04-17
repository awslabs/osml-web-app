// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import { computeSpatialOverlap } from "@/utils/analytics/compute-spatial-overlap";
import type {
  BBox,
  ComparisonResult,
  GeometryEntry
} from "@/utils/analytics/types";

function makeBBox(coords: [number, number][]): BBox {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return {
    minLng: Math.min(...lngs),
    minLat: Math.min(...lats),
    maxLng: Math.max(...lngs),
    maxLat: Math.max(...lats)
  };
}

function makePolygon(
  featureId: string,
  ring: [number, number][]
): GeometryEntry {
  return { type: "polygon", featureId, ring, bbox: makeBBox(ring) };
}

describe("computeSpatialOverlap - property tests", () => {
  describe("spatial overlap is a partition", () => {
    function makeGeometryEntryFromId(featureId: string): GeometryEntry {
      const ring: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0]
      ];
      return makePolygon(featureId, ring);
    }

    const uniqueIdsArb = fc.uniqueArray(
      fc.string({ minLength: 1, maxLength: 10, unit: "grapheme-ascii" }),
      { minLength: 0, maxLength: 8 }
    );

    it("every feature ID from layer A appears in exactly one category", () => {
      fc.assert(
        fc.property(uniqueIdsArb, uniqueIdsArb, (idsA, idsB) => {
          const usedIds = new Set(idsA);
          const filteredIdsB = idsB.filter((id) => !usedIds.has(id));
          const layerA = idsA.map((id) => makeGeometryEntryFromId(id));
          const layerB = filteredIdsB.map((id) => makeGeometryEntryFromId(id));
          const result: ComparisonResult = computeSpatialOverlap(
            layerA,
            layerB
          );
          const overlappingAIds = result.overlapping.map((o) => o.featureIdA);
          const allAIds = [...result.uniqueToA, ...overlappingAIds];
          expect(allAIds.sort()).toEqual([...idsA].sort());
          expect(new Set(allAIds).size).toBe(allAIds.length);
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("every feature ID from layer B appears in exactly one category", () => {
      fc.assert(
        fc.property(uniqueIdsArb, uniqueIdsArb, (idsA, idsB) => {
          const usedIds = new Set(idsA);
          const filteredIdsB = idsB.filter((id) => !usedIds.has(id));
          const layerA = idsA.map((id) => makeGeometryEntryFromId(id));
          const layerB = filteredIdsB.map((id) => makeGeometryEntryFromId(id));
          const result: ComparisonResult = computeSpatialOverlap(
            layerA,
            layerB
          );
          const overlappingBIds = result.overlapping.map((o) => o.featureIdB);
          const allBIds = [...result.uniqueToB, ...overlappingBIds];
          expect(allBIds.sort()).toEqual([...filteredIdsB].sort());
          expect(new Set(allBIds).size).toBe(allBIds.length);
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("no feature ID appears in both unique and overlapping categories", () => {
      fc.assert(
        fc.property(uniqueIdsArb, uniqueIdsArb, (idsA, idsB) => {
          const usedIds = new Set(idsA);
          const filteredIdsB = idsB.filter((id) => !usedIds.has(id));
          const layerA = idsA.map((id) => makeGeometryEntryFromId(id));
          const layerB = filteredIdsB.map((id) => makeGeometryEntryFromId(id));
          const result: ComparisonResult = computeSpatialOverlap(
            layerA,
            layerB
          );
          const uniqueASet = new Set(result.uniqueToA);
          const overlappingASet = new Set(
            result.overlapping.map((o) => o.featureIdA)
          );
          Array.from(overlappingASet).forEach((id) =>
            expect(uniqueASet.has(id)).toBe(false)
          );
          const uniqueBSet = new Set(result.uniqueToB);
          const overlappingBSet = new Set(
            result.overlapping.map((o) => o.featureIdB)
          );
          Array.from(overlappingBSet).forEach((id) =>
            expect(uniqueBSet.has(id)).toBe(false)
          );
          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
