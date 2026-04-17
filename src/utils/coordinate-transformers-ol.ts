// Copyright Amazon.com, Inc. or its affiliates.
import { transform, transformExtent } from "ol/proj";

import {
  clampExtent,
  type ViewportExtent,
  type WebMercatorCoordinates,
  type WGS84Coordinates
} from "@/utils/coordinate-transformers.ts";

/**
 * Transform WGS84 coordinates to Web Mercator (used by OpenLayers)
 */
export function wgs84ToWebMercator(
  coords: WGS84Coordinates
): WebMercatorCoordinates {
  const [x, y] = transform(
    [coords.longitude, coords.latitude],
    "EPSG:4326", // WGS84
    "EPSG:3857" // Web Mercator
  );

  return { x, y };
}

/**
 * Transform Web Mercator coordinates to WGS84
 */
export function webMercatorToWGS84(
  coords: WebMercatorCoordinates
): WGS84Coordinates {
  const [longitude, latitude] = transform(
    [coords.x, coords.y],
    "EPSG:3857", // Web Mercator
    "EPSG:4326" // WGS84
  );

  return { longitude, latitude };
}

/**
 * Transform WGS84 extent to Web Mercator extent
 */
export function wgs84ExtentToWebMercator(
  extent: ViewportExtent
): [number, number, number, number] {
  const clampedExtent = clampExtent(extent);

  const transformed = transformExtent(
    [
      clampedExtent.west,
      clampedExtent.south,
      clampedExtent.east,
      clampedExtent.north
    ],
    "EPSG:4326",
    "EPSG:3857"
  );

  return transformed as [number, number, number, number];
}

/**
 * Transform Web Mercator extent to WGS84 extent
 */
export function webMercatorExtentToWGS84(
  extent: [number, number, number, number]
): ViewportExtent {
  const transformed = transformExtent(extent, "EPSG:3857", "EPSG:4326");
  const [west, south, east, north] = transformed as [
    number,
    number,
    number,
    number
  ];

  return clampExtent({ west, south, east, north });
}
