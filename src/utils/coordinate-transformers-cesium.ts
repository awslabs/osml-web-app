// Copyright Amazon.com, Inc. or its affiliates.
import { Cartesian3, Ellipsoid, Math as CesiumMath, Rectangle } from "cesium";

import {
  clampExtent,
  type ViewportExtent,
  type WGS84Coordinates
} from "@/utils/coordinate-transformers.ts";

/**
 * Convert WGS84 coordinates to Cesium Cartesian3
 */
export function wgs84ToCartesian3(coords: WGS84Coordinates): Cartesian3 {
  return Cartesian3.fromDegrees(
    coords.longitude,
    coords.latitude,
    coords.height || 0
  );
}

/**
 * Convert Cesium Cartesian3 to WGS84 coordinates
 */
export function cartesian3ToWGS84(cartesian: Cartesian3): WGS84Coordinates {
  const cartographic = Ellipsoid.WGS84.cartesianToCartographic(cartesian);

  return {
    longitude: CesiumMath.toDegrees(cartographic.longitude),
    latitude: CesiumMath.toDegrees(cartographic.latitude),
    height: cartographic.height
  };
}

/**
 * Convert Cesium camera height to approximate zoom level
 */
export function heightToZoom(height: number): number {
  const baseHeight = 15000000;
  const zoom = Math.max(0, Math.min(19, Math.log2(baseHeight / height)));

  return Math.round(zoom);
}

/**
 * Convert zoom level to Cesium camera height
 */
export function zoomToHeight(zoom: number): number {
  const baseHeight = 15000000;

  return baseHeight / Math.pow(2, zoom);
}

/**
 * Calculate Cesium camera height from extent bounds for accurate correspondence
 */
export function extentToHeight(
  extent: ViewportExtent,
  latitude: number
): number {
  const extentWidth = Math.abs(extent.east - extent.west);
  const extentHeight = Math.abs(extent.north - extent.south);
  const maxDimension = Math.max(extentWidth, extentHeight);
  const latitudeCorrection = Math.cos(CesiumMath.toRadians(Math.abs(latitude)));
  const adjustedDimension = maxDimension / Math.max(latitudeCorrection, 0.1);
  const earthRadius = 6378137;
  const cameraHeight = (adjustedDimension * earthRadius) / 57.2958;

  return Math.max(1000, cameraHeight);
}

/**
 * Convert ViewportExtent to Cesium Rectangle
 */
export function extentToRectangle(extent: ViewportExtent): Rectangle {
  return Rectangle.fromDegrees(
    extent.west,
    extent.south,
    extent.east,
    extent.north
  );
}

/**
 * Convert Cesium Rectangle to ViewportExtent
 */
export function rectangleToExtent(rectangle: Rectangle): ViewportExtent {
  const extent = {
    west: CesiumMath.toDegrees(rectangle.west),
    south: CesiumMath.toDegrees(rectangle.south),
    east: CesiumMath.toDegrees(rectangle.east),
    north: CesiumMath.toDegrees(rectangle.north)
  };

  return clampExtent(extent);
}

/**
 * Calculate zoom level from extent (approximate conversion for synchronization)
 */
export function calculateZoomFromExtent(extent: ViewportExtent): number {
  const widthDegrees = Math.abs(extent.east - extent.west);
  const zoom = Math.max(0, Math.min(19, Math.log2(360 / widthDegrees)));

  return Math.round(zoom);
}

/**
 * Calculate extent from center and zoom level (approximate)
 */
export function calculateExtentFromZoom(
  center: WGS84Coordinates,
  zoom: number
): ViewportExtent {
  const worldWidth = 360;
  const zoomFactor = Math.pow(2, zoom);
  const extentWidth = worldWidth / zoomFactor;
  const extentHeight =
    extentWidth * Math.cos(CesiumMath.toRadians(center.latitude));

  return {
    west: center.longitude - extentWidth / 2,
    east: center.longitude + extentWidth / 2,
    south: center.latitude - extentHeight / 2,
    north: center.latitude + extentHeight / 2
  };
}
