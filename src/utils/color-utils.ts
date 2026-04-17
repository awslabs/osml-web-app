// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Pure utility functions extracted from the Cesium globe component.
 * These functions have no Cesium runtime dependency and are testable in isolation.
 */

/**
 * Generate a base64-encoded SVG circle used as a click-marker billboard image.
 * @param cssColor - CSS color string (e.g., "#ff0000")
 * @returns Data URI string for the SVG image
 */
export function buildMarkerSvg(cssColor: string): string {
  const svg =
    `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">` +
    `<circle cx="16" cy="16" r="14" fill="${cssColor}" opacity="0.8"/>` +
    `<circle cx="16" cy="16" r="8" fill="white"/>` +
    `</svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}

/**
 * Convert a hex color string to RGBA components.
 * @param hex - Hex color string (e.g., "#ff0000")
 * @returns Object with r, g, b values (0-255)
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

/**
 * Convert a hex color string to an RGBA CSS string.
 * Used by both OpenLayers map and Cesium globe for feature styling.
 * @param hex - Hex color string (e.g., "#ff0000")
 * @param opacity - Opacity value (0-1)
 * @returns RGBA CSS string (e.g., "rgba(255, 0, 0, 0.5)")
 */
export function hexToRgba(hex: string, opacity: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Append an opacity value as a hex suffix to a color string.
 * Used for OpenLayers fill colors that expect hex+alpha format.
 * @param hex - Hex color string (e.g., "#ff0000")
 * @param opacity - Opacity value (0-1)
 * @returns Hex color with alpha suffix (e.g., "#ff000080")
 */
export function hexWithAlpha(hex: string, opacity: number): string {
  return (
    hex +
    Math.round(opacity * 255)
      .toString(16)
      .padStart(2, "0")
  );
}

/**
 * Compute a confidence-based color on a red-to-green gradient.
 * Used by both map and globe for confidence-based feature coloring.
 * @param confidence - Confidence value (0-1)
 * @returns Hex color string
 */
export function confidenceToColor(confidence: number): string {
  const r =
    confidence < 0.5 ? 255 : Math.round((1.0 - (confidence - 0.5) * 2) * 255);
  const g = confidence < 0.5 ? Math.round(confidence * 2 * 255) : 255;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}00`;
}
