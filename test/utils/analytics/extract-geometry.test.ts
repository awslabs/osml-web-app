// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";
import type { Feature } from "geojson";

import { extractGeometry } from "@/utils/analytics/extract-geometry";
import type { GeometryEntry } from "@/utils/analytics/types";

// ---------------------------------------------------------------------------
// Helpers & Generators
// ---------------------------------------------------------------------------

/** Generate a random [lng, lat] coordinate pair. */
const coordArb = fc.tuple(
  fc.double({ min: -180, max: 180, noNaN: true }),
  fc.double({ min: -90, max: 90, noNaN: true })
);

/** Generate a ring (array of coordinate pairs) with at least 4 points. */
const ringArb = fc.array(coordArb, { minLength: 4, maxLength: 10 });

/** Generate a path (array of coordinate pairs) with at least 2 points. */
const pathArb = fc.array(coordArb, { minLength: 2, maxLength: 10 });

/** Helper to build a test feature with a given geometry. */
function makeFeature(
  geometry: Record<string, unknown>,
  id?: string | number
): Feature {
  return {
    type: "Feature",
    id: id ?? "test-feature",
    properties: {},
    geometry: geometry as unknown as Feature["geometry"]
  };
}

/** Compute expected bbox from an array of [number, number] pairs. */
function expectedBBox(coords: [number, number][]) {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return {
    minLng: Math.min(...lngs),
    minLat: Math.min(...lats),
    maxLng: Math.max(...lngs),
    maxLat: Math.max(...lats)
  };
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("extractGeometry", () => {
  describe("unit tests", () => {
    it("extracts exterior ring from a Polygon geometry", () => {
      const ring: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0]
      ];
      const feature = makeFeature({
        type: "Polygon",
        coordinates: [ring]
      });

      const result = extractGeometry(feature);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("polygon");
      expect(
        (result[0] as Extract<GeometryEntry, { type: "polygon" }>).ring
      ).toEqual(ring);
    });

    it("extracts multiple entries from a MultiPolygon geometry", () => {
      const ring1: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0]
      ];
      const ring2: [number, number][] = [
        [10, 10],
        [11, 10],
        [11, 11],
        [10, 10]
      ];
      const feature = makeFeature({
        type: "MultiPolygon",
        coordinates: [[ring1], [ring2]]
      });

      const result = extractGeometry(feature);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("polygon");
      expect(result[1].type).toBe("polygon");
      expect(
        (result[0] as Extract<GeometryEntry, { type: "polygon" }>).ring
      ).toEqual(ring1);
      expect(
        (result[1] as Extract<GeometryEntry, { type: "polygon" }>).ring
      ).toEqual(ring2);
    });

    it("extracts a single position from a Point geometry", () => {
      const feature = makeFeature({
        type: "Point",
        coordinates: [42.5, -73.2]
      });

      const result = extractGeometry(feature);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("point");
      expect(
        (result[0] as Extract<GeometryEntry, { type: "point" }>).position
      ).toEqual([42.5, -73.2]);
    });

    it("extracts coordinate path from a LineString geometry", () => {
      const path: [number, number][] = [
        [0, 0],
        [1, 1],
        [2, 0]
      ];
      const feature = makeFeature({
        type: "LineString",
        coordinates: path
      });

      const result = extractGeometry(feature);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("linestring");
      expect(
        (result[0] as Extract<GeometryEntry, { type: "linestring" }>).path
      ).toEqual(path);
    });

    it("computes correct bbox for a Polygon", () => {
      const ring: [number, number][] = [
        [-10, -20],
        [30, -20],
        [30, 40],
        [-10, 40],
        [-10, -20]
      ];
      const feature = makeFeature({
        type: "Polygon",
        coordinates: [ring]
      });

      const result = extractGeometry(feature);

      expect(result).toHaveLength(1);
      expect(result[0].bbox).toEqual({
        minLng: -10,
        minLat: -20,
        maxLng: 30,
        maxLat: 40
      });
    });

    it("computes correct bbox for a Point (degenerate bbox)", () => {
      const feature = makeFeature({
        type: "Point",
        coordinates: [5, 10]
      });

      const result = extractGeometry(feature);

      expect(result[0].bbox).toEqual({
        minLng: 5,
        minLat: 10,
        maxLng: 5,
        maxLat: 10
      });
    });

    it("computes correct bbox for a LineString", () => {
      const path: [number, number][] = [
        [-5, 3],
        [10, -7],
        [0, 15]
      ];
      const feature = makeFeature({
        type: "LineString",
        coordinates: path
      });

      const result = extractGeometry(feature);

      expect(result[0].bbox).toEqual({
        minLng: -5,
        minLat: -7,
        maxLng: 10,
        maxLat: 15
      });
    });

    it("computes correct bbox for each polygon in a MultiPolygon", () => {
      const ring1: [number, number][] = [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 0]
      ];
      const ring2: [number, number][] = [
        [10, 10],
        [15, 10],
        [15, 20],
        [10, 10]
      ];
      const feature = makeFeature({
        type: "MultiPolygon",
        coordinates: [[ring1], [ring2]]
      });

      const result = extractGeometry(feature);

      expect(result[0].bbox).toEqual({
        minLng: 0,
        minLat: 0,
        maxLng: 2,
        maxLat: 2
      });
      expect(result[1].bbox).toEqual({
        minLng: 10,
        minLat: 10,
        maxLng: 15,
        maxLat: 20
      });
    });

    it("uses feature id as featureId in entries", () => {
      const feature = makeFeature(
        { type: "Point", coordinates: [1, 2] },
        "my-feature-123"
      );

      const result = extractGeometry(feature);

      expect(result[0].featureId).toBe("my-feature-123");
    });

    it("uses stringified numeric feature id", () => {
      const feature = makeFeature({ type: "Point", coordinates: [1, 2] }, 42);

      const result = extractGeometry(feature);

      expect(result[0].featureId).toBe("42");
    });

    it("returns empty array for unsupported geometry types", () => {
      const feature = makeFeature({
        type: "GeometryCollection",
        geometries: [{ type: "Point", coordinates: [0, 0] }]
      });

      const result = extractGeometry(feature);

      expect(result).toEqual([]);
    });

    it("returns empty array when geometry is null", () => {
      const feature: Feature = {
        type: "Feature",
        properties: {},
        geometry: null as unknown as Feature["geometry"]
      };

      const result = extractGeometry(feature);

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Property-Based Tests
  // -------------------------------------------------------------------------

  describe("geometry extraction preserves coordinates", () => {
    it("Polygon returns exactly one entry with the exterior ring coordinates preserved", () => {
      fc.assert(
        fc.property(ringArb, (ring) => {
          const feature = makeFeature({
            type: "Polygon",
            coordinates: [ring]
          });

          const result = extractGeometry(feature);

          expect(result).toHaveLength(1);
          expect(result[0].type).toBe("polygon");
          const entry = result[0] as Extract<
            GeometryEntry,
            { type: "polygon" }
          >;
          expect(entry.ring).toEqual(ring);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("MultiPolygon returns one entry per polygon with coordinates preserved", () => {
      const multiRingsArb = fc.array(ringArb, { minLength: 1, maxLength: 5 });

      fc.assert(
        fc.property(multiRingsArb, (rings) => {
          const feature = makeFeature({
            type: "MultiPolygon",
            coordinates: rings.map((r) => [r])
          });

          const result = extractGeometry(feature);

          expect(result).toHaveLength(rings.length);
          rings.forEach((ring, i) => {
            expect(result[i].type).toBe("polygon");
            const entry = result[i] as Extract<
              GeometryEntry,
              { type: "polygon" }
            >;
            expect(entry.ring).toEqual(ring);
          });

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("Point returns exactly one entry with the position preserved", () => {
      fc.assert(
        fc.property(coordArb, (coord) => {
          const feature = makeFeature({
            type: "Point",
            coordinates: coord
          });

          const result = extractGeometry(feature);

          expect(result).toHaveLength(1);
          expect(result[0].type).toBe("point");
          const entry = result[0] as Extract<GeometryEntry, { type: "point" }>;
          expect(entry.position).toEqual(coord);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("LineString returns exactly one entry with the path preserved", () => {
      fc.assert(
        fc.property(pathArb, (path) => {
          const feature = makeFeature({
            type: "LineString",
            coordinates: path
          });

          const result = extractGeometry(feature);

          expect(result).toHaveLength(1);
          expect(result[0].type).toBe("linestring");
          const entry = result[0] as Extract<
            GeometryEntry,
            { type: "linestring" }
          >;
          expect(entry.path).toEqual(path);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("bbox is correctly computed for all geometry types", () => {
      const geometryArb = fc.oneof(
        // Polygon
        ringArb.map((ring) => ({
          geom: { type: "Polygon" as const, coordinates: [ring] },
          allCoords: ring
        })),
        // Point
        coordArb.map((coord) => ({
          geom: { type: "Point" as const, coordinates: coord },
          allCoords: [coord] as [number, number][]
        })),
        // LineString
        pathArb.map((path) => ({
          geom: { type: "LineString" as const, coordinates: path },
          allCoords: path
        }))
      );

      fc.assert(
        fc.property(geometryArb, ({ geom, allCoords }) => {
          const feature = makeFeature(geom);
          const result = extractGeometry(feature);

          expect(result.length).toBeGreaterThanOrEqual(1);

          const expected = expectedBBox(allCoords);
          expect(result[0].bbox.minLng).toBeCloseTo(expected.minLng, 10);
          expect(result[0].bbox.minLat).toBeCloseTo(expected.minLat, 10);
          expect(result[0].bbox.maxLng).toBeCloseTo(expected.maxLng, 10);
          expect(result[0].bbox.maxLat).toBeCloseTo(expected.maxLat, 10);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it("entry count matches expected count for each geometry type", () => {
      const numPolygonsArb = fc.integer({ min: 1, max: 5 });

      fc.assert(
        fc.property(numPolygonsArb, ringArb, (numPolygons, ring) => {
          // MultiPolygon: entry count = number of polygons
          const multiFeature = makeFeature({
            type: "MultiPolygon",
            coordinates: Array.from({ length: numPolygons }, () => [ring])
          });
          expect(extractGeometry(multiFeature)).toHaveLength(numPolygons);

          // Polygon: always 1 entry
          const polyFeature = makeFeature({
            type: "Polygon",
            coordinates: [ring]
          });
          expect(extractGeometry(polyFeature)).toHaveLength(1);

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
