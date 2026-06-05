// Copyright Amazon.com, Inc. or its affiliates.
/**
 * WebGL support detection and style variable utilities.
 * Used for GPU-accelerated image rendering with OpenLayers WebGLTileLayer.
 * Requirements: 1.5
 */

import { ImageAdjustments } from "@/utils/image-adjustments";

/**
 * Style variables object for WebGLTileLayer.updateStyleVariables()
 */
export interface WebGLStyleVariables {
  [key: string]: number; // Index signature required by updateStyleVariables
  exposure: number;
  contrast: number;
  saturation: number;
  gamma: number;
  redGain: number;
  greenGain: number;
  blueGain: number;
}

/**
 * Checks if WebGL is supported by the browser.
 * @returns True if WebGL is supported, false otherwise.
 */
export function isWebGLSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

/**
 * Converts ImageAdjustments state to WebGL style variables object.
 * This function prepares the adjustment values for use with WebGLTileLayer.updateStyleVariables().
 * Requirements: 1.4, 2.2, 3.2, 4.2, 5.2, 6.2
 *
 * @param adjustments - The current image adjustments from Redux state
 * @returns Style variables object for WebGLTileLayer
 */
export function adjustmentsToStyleVariables(
  adjustments: ImageAdjustments
): WebGLStyleVariables {
  return {
    exposure: adjustments.exposure,
    contrast: adjustments.contrast,
    saturation: adjustments.saturation,
    gamma: adjustments.gamma,
    redGain: adjustments.redGain,
    greenGain: adjustments.greenGain,
    blueGain: adjustments.blueGain
  };
}
