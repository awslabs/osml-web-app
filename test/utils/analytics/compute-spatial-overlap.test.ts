// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for compute-spatial-overlap.ts.
 * Covers polygon-polygon, point-polygon, linestring-polygon,
 * point-point, linestring-linestring, containment, and edge cases.
 */

import { computeSpatialOverlap } from "@/utils/analytics/compute-spatial-overlap";
import type { BBox, GeometryEntry } from "@/utils/analytics/types";

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

function makePoint(
  featureId: string,
  position: [number, number]
): GeometryEntry {
  return {
    type: "point",
    featureId,
    position,
    bbox: {
      minLng: position[0],
      minLat: position[1],
      maxLng: position[0],
      maxLat: position[1]
    }
  };
}

function makeLine(featureId: string, path: [number, number][]): GeometryEntry {
  const lngs = path.map((p) => p[0]);
  const lats = path.map((p) => p[1]);
  return {
    featureId,
    type: "linestring",
    path,
    bbox: {
      minLng: Math.min(...lngs),
      minLat: Math.min(...lats),
      maxLng: Math.max(...lngs),
      maxLat: Math.max(...lats)
    }
  };
}

const UNIT_SQUARE: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0]
];
const FAR_SQUARE: [number, number][] = [
  [100, 100],
  [101, 100],
  [101, 101],
  [100, 101],
  [100, 100]
];

describe("computeSpatialOverlap", () => {
  it("returns empty result for two empty arrays", () => {
    const r = computeSpatialOverlap([], []);
    expect(r.uniqueToA).toEqual([]);
    expect(r.uniqueToB).toEqual([]);
    expect(r.overlapping).toEqual([]);
  });

  it("returns all as uniqueToA when layerB empty", () => {
    const r = computeSpatialOverlap([makePolygon("a1", UNIT_SQUARE)], []);
    expect(r.uniqueToA).toEqual(["a1"]);
  });

  it("returns all as uniqueToB when layerA empty", () => {
    const r = computeSpatialOverlap([], [makePolygon("b1", UNIT_SQUARE)]);
    expect(r.uniqueToB).toEqual(["b1"]);
  });

  it("detects identical polygons as overlapping", () => {
    const r = computeSpatialOverlap(
      [makePolygon("a1", UNIT_SQUARE)],
      [makePolygon("b1", UNIT_SQUARE)]
    );
    expect(r.overlapping).toEqual([{ featureIdA: "a1", featureIdB: "b1" }]);
  });

  it("classifies disjoint polygons as unique", () => {
    const r = computeSpatialOverlap(
      [makePolygon("a1", UNIT_SQUARE)],
      [makePolygon("b1", FAR_SQUARE)]
    );
    expect(r.uniqueToA).toEqual(["a1"]);
    expect(r.uniqueToB).toEqual(["b1"]);
  });

  it("detects point inside polygon", () => {
    const r = computeSpatialOverlap(
      [makePolygon("a1", UNIT_SQUARE)],
      [makePoint("b1", [0.5, 0.5])]
    );
    expect(r.overlapping).toHaveLength(1);
  });

  it("classifies point outside polygon as unique", () => {
    const r = computeSpatialOverlap(
      [makePolygon("a1", UNIT_SQUARE)],
      [makePoint("b1", [50, 50])]
    );
    expect(r.overlapping).toHaveLength(0);
  });

  it("detects partially overlapping polygons", () => {
    const shifted: [number, number][] = [
      [0.5, 0.5],
      [1.5, 0.5],
      [1.5, 1.5],
      [0.5, 1.5],
      [0.5, 0.5]
    ];
    const r = computeSpatialOverlap(
      [makePolygon("a1", UNIT_SQUARE)],
      [makePolygon("b1", shifted)]
    );
    expect(r.overlapping).toHaveLength(1);
  });

  it("handles multiple features in both layers", () => {
    const r = computeSpatialOverlap(
      [makePolygon("a1", UNIT_SQUARE), makePolygon("a2", FAR_SQUARE)],
      [
        makePolygon("b1", UNIT_SQUARE),
        makePolygon("b2", [
          [50, 50],
          [51, 50],
          [51, 51],
          [50, 51],
          [50, 50]
        ])
      ]
    );
    expect(r.overlapping).toHaveLength(1);
    expect(r.uniqueToA).toContain("a2");
    expect(r.uniqueToB).toContain("b2");
  });
});

describe("computeSpatialOverlap - geometry type interactions", () => {
  describe("point as layer A, polygon as layer B", () => {
    it("should detect point inside polygon", () => {
      const r = computeSpatialOverlap(
        [makePoint("a1", [0.5, 0.5])],
        [makePolygon("b1", UNIT_SQUARE)]
      );
      expect(r.overlapping).toHaveLength(1);
    });
  });

  describe("polygon containment", () => {
    it("should detect inner polygon inside outer", () => {
      const outer: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0]
      ];
      const inner: [number, number][] = [
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
        [2, 2]
      ];
      const r = computeSpatialOverlap(
        [makePolygon("a1", outer)],
        [makePolygon("b1", inner)]
      );
      expect(r.overlapping).toHaveLength(1);
    });
  });

  describe("linestring-polygon", () => {
    it("should detect crossing", () => {
      const r = computeSpatialOverlap(
        [
          makeLine("a1", [
            [-1, 0.5],
            [2, 0.5]
          ])
        ],
        [makePolygon("b1", UNIT_SQUARE)]
      );
      expect(r.overlapping).toHaveLength(1);
    });

    it("should detect linestring inside polygon", () => {
      const r = computeSpatialOverlap(
        [
          makeLine("a1", [
            [0.2, 0.2],
            [0.8, 0.8]
          ])
        ],
        [makePolygon("b1", UNIT_SQUARE)]
      );
      expect(r.overlapping).toHaveLength(1);
    });

    it("should detect polygon-linestring (reversed)", () => {
      const r = computeSpatialOverlap(
        [makePolygon("a1", UNIT_SQUARE)],
        [
          makeLine("b1", [
            [-1, 0.5],
            [2, 0.5]
          ])
        ]
      );
      expect(r.overlapping).toHaveLength(1);
    });

    it("should not match linestring outside polygon", () => {
      const r = computeSpatialOverlap(
        [
          makeLine("a1", [
            [5, 5],
            [6, 6]
          ])
        ],
        [makePolygon("b1", UNIT_SQUARE)]
      );
      expect(r.overlapping).toHaveLength(0);
    });
  });

  describe("linestring-linestring", () => {
    it("should detect crossing", () => {
      const r = computeSpatialOverlap(
        [
          makeLine("a1", [
            [0, 0],
            [1, 1]
          ])
        ],
        [
          makeLine("b1", [
            [0, 1],
            [1, 0]
          ])
        ]
      );
      expect(r.overlapping).toHaveLength(1);
    });

    it("should not match parallel", () => {
      const r = computeSpatialOverlap(
        [
          makeLine("a1", [
            [0, 0],
            [1, 0]
          ])
        ],
        [
          makeLine("b1", [
            [0, 2],
            [1, 2]
          ])
        ]
      );
      expect(r.overlapping).toHaveLength(0);
    });
  });

  describe("point-point", () => {
    it("should detect exact match", () => {
      const r = computeSpatialOverlap(
        [makePoint("a1", [5, 5])],
        [makePoint("b1", [5, 5])]
      );
      expect(r.overlapping).toHaveLength(1);
    });

    it("should not match different points", () => {
      const r = computeSpatialOverlap(
        [makePoint("a1", [5, 5])],
        [makePoint("b1", [6, 6])]
      );
      expect(r.overlapping).toHaveLength(0);
    });
  });

  describe("linestring-point (no meaningful intersection)", () => {
    it("should return no overlap", () => {
      const r = computeSpatialOverlap(
        [
          makeLine("a1", [
            [0, 0],
            [1, 1]
          ])
        ],
        [makePoint("b1", [0.5, 0.5])]
      );
      expect(r.overlapping).toHaveLength(0);
    });
  });
});
