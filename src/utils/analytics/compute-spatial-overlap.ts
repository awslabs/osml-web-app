// Copyright Amazon.com, Inc. or its affiliates.
import type { BBox, ComparisonResult, GeometryEntry } from "./types";

/**
 * Check if two axis-aligned bounding boxes overlap.
 */
function bboxOverlap(a: BBox, b: BBox): boolean {
  return (
    a.minLng <= b.maxLng &&
    a.maxLng >= b.minLng &&
    a.minLat <= b.maxLat &&
    a.maxLat >= b.minLat
  );
}

/**
 * Ray-casting algorithm to test if a point is inside a polygon ring.
 * The ring is an array of [lng, lat] pairs (closed or open).
 */
function pointInPolygon(
  point: [number, number],
  ring: [number, number][]
): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Check if two line segments (p1-p2) and (p3-p4) intersect.
 */
function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }

  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;

  return false;
}

function direction(
  a: [number, number],
  b: [number, number],
  c: [number, number]
): number {
  return (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
}

function onSegment(
  a: [number, number],
  b: [number, number],
  c: [number, number]
): boolean {
  return (
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1])
  );
}

/**
 * Check if any edge of polygon ring A crosses any edge of polygon ring B.
 */
function edgesIntersect(
  ringA: [number, number][],
  ringB: [number, number][]
): boolean {
  for (let i = 0; i < ringA.length - 1; i++) {
    for (let j = 0; j < ringB.length - 1; j++) {
      if (segmentsIntersect(ringA[i], ringA[i + 1], ringB[j], ringB[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if two polygon rings overlap. Uses vertex containment and edge crossing.
 */
function polygonsOverlap(
  ringA: [number, number][],
  ringB: [number, number][]
): boolean {
  // Check if any vertex of A is inside B
  for (const vertex of ringA) {
    if (pointInPolygon(vertex, ringB)) return true;
  }
  // Check if any vertex of B is inside A
  for (const vertex of ringB) {
    if (pointInPolygon(vertex, ringA)) return true;
  }
  // Check if any edges cross
  return edgesIntersect(ringA, ringB);
}

/**
 * Check if a polyline path intersects a polygon ring.
 * A polyline intersects if any vertex is inside the polygon or any segment crosses an edge.
 */
function polylineIntersectsPolygon(
  path: [number, number][],
  ring: [number, number][]
): boolean {
  // Check if any polyline vertex is inside the polygon
  for (const vertex of path) {
    if (pointInPolygon(vertex, ring)) return true;
  }
  // Check if any polyline segment crosses any polygon edge
  for (let i = 0; i < path.length - 1; i++) {
    for (let j = 0; j < ring.length - 1; j++) {
      if (segmentsIntersect(path[i], path[i + 1], ring[j], ring[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Get the polygon ring from a geometry entry, if it is a polygon.
 */
function getRing(entry: GeometryEntry): [number, number][] | null {
  return entry.type === "polygon" ? entry.ring : null;
}

/**
 * Test whether two geometry entries spatially intersect.
 */
function geometriesIntersect(a: GeometryEntry, b: GeometryEntry): boolean {
  // Bounding box pre-filter
  if (!bboxOverlap(a.bbox, b.bbox)) return false;

  const ringA = getRing(a);
  const ringB = getRing(b);

  // polygon-polygon
  if (ringA && ringB) {
    return polygonsOverlap(ringA, ringB);
  }

  // point-in-polygon (a=polygon, b=point)
  if (ringA && b.type === "point") {
    return pointInPolygon(b.position, ringA);
  }

  // point-in-polygon (a=point, b=polygon)
  if (a.type === "point" && ringB) {
    return pointInPolygon(a.position, ringB);
  }

  // polyline-polygon (a=linestring, b=polygon)
  if (a.type === "linestring" && ringB) {
    return polylineIntersectsPolygon(a.path, ringB);
  }

  // polyline-polygon (a=polygon, b=linestring)
  if (ringA && b.type === "linestring") {
    return polylineIntersectsPolygon(b.path, ringA);
  }

  // point-point: exact match
  if (a.type === "point" && b.type === "point") {
    return a.position[0] === b.position[0] && a.position[1] === b.position[1];
  }

  // linestring-linestring: check segment crossings
  if (a.type === "linestring" && b.type === "linestring") {
    for (let i = 0; i < a.path.length - 1; i++) {
      for (let j = 0; j < b.path.length - 1; j++) {
        if (
          segmentsIntersect(a.path[i], a.path[i + 1], b.path[j], b.path[j + 1])
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // linestring-point or point-linestring: not handled (no meaningful intersection)
  return false;
}

/**
 * Compute spatial overlap between two layers of geometry entries.
 *
 * For each feature in layer A, checks if it overlaps with any feature in layer B
 * using bounding-box pre-filtering followed by actual geometry intersection tests.
 *
 * Returns feature IDs classified into unique-to-A, unique-to-B, or overlapping pairs.
 */
export function computeSpatialOverlap(
  layerA: GeometryEntry[],
  layerB: GeometryEntry[]
): ComparisonResult {
  const uniqueToA: string[] = [];
  const uniqueToB: string[] = [];
  const overlapping: Array<{ featureIdA: string; featureIdB: string }> = [];

  const matchedAIds = new Set<string>();
  const matchedBIds = new Set<string>();

  // Greedy 1-to-1 matching: each A pairs with at most one B, each B with at most one A
  for (const a of layerA) {
    for (const b of layerB) {
      if (matchedBIds.has(b.featureId)) continue;
      if (geometriesIntersect(a, b)) {
        overlapping.push({ featureIdA: a.featureId, featureIdB: b.featureId });
        matchedAIds.add(a.featureId);
        matchedBIds.add(b.featureId);
        break;
      }
    }
  }

  for (const a of layerA) {
    if (!matchedAIds.has(a.featureId)) {
      uniqueToA.push(a.featureId);
    }
  }

  for (const b of layerB) {
    if (!matchedBIds.has(b.featureId)) {
      uniqueToB.push(b.featureId);
    }
  }

  return { uniqueToA, uniqueToB, overlapping };
}
