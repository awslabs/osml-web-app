// Copyright Amazon.com, Inc. or its affiliates.
/** Image adjustment domain: value ranges, defaults, and clamping helpers
 *  shared by the image-viewer slice, WebGL rendering, and the controls UI. */

export interface ImageAdjustments {
  exposure: number; // -1 to 1, default 0
  contrast: number; // -1 to 1, default 0
  saturation: number; // -1 to 1, default 0
  gamma: number; // 0.1 to 3.0, default 1.0
  redGain: number; // 0 to 2, default 1.0
  greenGain: number; // 0 to 2, default 1.0
  blueGain: number; // 0 to 2, default 1.0
}

export interface AdjustmentConstraints {
  min: number;
  max: number;
  default: number;
}

export const ADJUSTMENT_CONSTRAINTS: Record<
  keyof ImageAdjustments,
  AdjustmentConstraints
> = {
  exposure: { min: -1, max: 1, default: 0 },
  contrast: { min: -1, max: 1, default: 0 },
  saturation: { min: -1, max: 1, default: 0 },
  gamma: { min: 0.1, max: 3.0, default: 1.0 },
  redGain: { min: 0, max: 2, default: 1.0 },
  greenGain: { min: 0, max: 2, default: 1.0 },
  blueGain: { min: 0, max: 2, default: 1.0 }
};

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  exposure: ADJUSTMENT_CONSTRAINTS.exposure.default,
  contrast: ADJUSTMENT_CONSTRAINTS.contrast.default,
  saturation: ADJUSTMENT_CONSTRAINTS.saturation.default,
  gamma: ADJUSTMENT_CONSTRAINTS.gamma.default,
  redGain: ADJUSTMENT_CONSTRAINTS.redGain.default,
  greenGain: ADJUSTMENT_CONSTRAINTS.greenGain.default,
  blueGain: ADJUSTMENT_CONSTRAINTS.blueGain.default
};

/**
 * Clamps an adjustment value to its valid range.
 * @param key - The adjustment key (exposure, contrast, etc.)
 * @param value - The value to clamp
 * @returns The clamped value within the valid range
 */
export function clampAdjustment(
  key: keyof ImageAdjustments,
  value: number
): number {
  const constraints = ADJUSTMENT_CONSTRAINTS[key];
  return Math.max(constraints.min, Math.min(constraints.max, value));
}

/**
 * Checks if an adjustment value is within its valid range.
 * @param key - The adjustment key (exposure, contrast, etc.)
 * @param value - The value to validate
 * @returns True if the value is within the valid range
 */
export function isValidAdjustment(
  key: keyof ImageAdjustments,
  value: number
): boolean {
  const constraints = ADJUSTMENT_CONSTRAINTS[key];
  return value >= constraints.min && value <= constraints.max;
}
