// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Button } from "@heroui/button";

import { AdjustmentSlider } from "@/components/image-adjustment/image-adjustment-slider";
import { useAutoAdjust } from "@/contexts/auto-adjust-context";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  resetAdjustments,
  setAllAdjustments
} from "@/store/slices/image-viewer-slice";
import { applyAutoAdjustPreservingRgbGains } from "@/utils/auto-adjust";
import {
  ADJUSTMENT_CONSTRAINTS,
  ImageAdjustments
} from "@/utils/image-adjustments";

export interface ImageAdjustmentControlsProps {
  disabled?: boolean;
  onAutoAdjustError?: (message: string) => void;
}

/**
 * Image adjustment controls component with sliders for exposure, contrast,
 * saturation, gamma, and RGB gains.
 * Requirements: 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 10.3
 */
export const ImageAdjustmentControls = ({
  disabled = false,
  onAutoAdjustError
}: ImageAdjustmentControlsProps) => {
  const dispatch = useAppDispatch();
  const autoAdjustContext = useAutoAdjust();
  const currentAdjustments = useAppSelector(
    (state) => state.imageViewer.currentAdjustments
  );
  const selectedViewpoint = useAppSelector(
    (state) => state.imageViewer.selectedViewpoint
  );

  const isDisabled = disabled || !selectedViewpoint;

  const handleAdjustmentChange = (
    key: keyof ImageAdjustments,
    value: number
  ) => {
    dispatch(setAllAdjustments({ ...currentAdjustments, [key]: value }));
  };

  const handleReset = () => {
    // Clear the cached baseline histogram so next auto-adjust captures fresh data
    if (autoAdjustContext) {
      autoAdjustContext.clearBaselineHistogram();
    }
    dispatch(resetAdjustments());
  };

  /**
   * Handles the Auto button click.
   * Requirements: 8.7, 8.9, 8.10
   */
  const handleAuto = async () => {
    if (!autoAdjustContext) {
      onAutoAdjustError?.("Auto-adjust not available");
      return;
    }

    const result = await autoAdjustContext.performAutoAdjust();

    if (!result) {
      onAutoAdjustError?.("Unable to analyze image data");
      return;
    }

    if (!result.success) {
      onAutoAdjustError?.(result.error || "Auto-adjust failed");
      return;
    }

    if (result.adjustments) {
      // Apply optimal adjustments while preserving RGB gains (Requirement 8.9)
      const newAdjustments = applyAutoAdjustPreservingRgbGains(
        currentAdjustments,
        result.adjustments
      );
      dispatch(setAllAdjustments(newAdjustments));
    }
  };

  if (isDisabled) {
    return (
      <div className="p-4 text-center text-default-500">
        Select a viewpoint to adjust image settings
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-2">
      {/* Exposure slider */}
      <AdjustmentSlider
        defaultValue={ADJUSTMENT_CONSTRAINTS.exposure.default}
        disabled={isDisabled}
        label="Exposure"
        max={ADJUSTMENT_CONSTRAINTS.exposure.max}
        min={ADJUSTMENT_CONSTRAINTS.exposure.min}
        step={0.01}
        value={currentAdjustments.exposure}
        onChange={(value) => handleAdjustmentChange("exposure", value)}
      />

      {/* Contrast slider */}
      <AdjustmentSlider
        defaultValue={ADJUSTMENT_CONSTRAINTS.contrast.default}
        disabled={isDisabled}
        label="Contrast"
        max={ADJUSTMENT_CONSTRAINTS.contrast.max}
        min={ADJUSTMENT_CONSTRAINTS.contrast.min}
        step={0.01}
        value={currentAdjustments.contrast}
        onChange={(value) => handleAdjustmentChange("contrast", value)}
      />

      {/* Saturation slider */}
      <AdjustmentSlider
        defaultValue={ADJUSTMENT_CONSTRAINTS.saturation.default}
        disabled={isDisabled}
        label="Saturation"
        max={ADJUSTMENT_CONSTRAINTS.saturation.max}
        min={ADJUSTMENT_CONSTRAINTS.saturation.min}
        step={0.01}
        value={currentAdjustments.saturation}
        onChange={(value) => handleAdjustmentChange("saturation", value)}
      />

      {/* Gamma slider */}
      <AdjustmentSlider
        defaultValue={ADJUSTMENT_CONSTRAINTS.gamma.default}
        disabled={isDisabled}
        label="Gamma"
        max={ADJUSTMENT_CONSTRAINTS.gamma.max}
        min={ADJUSTMENT_CONSTRAINTS.gamma.min}
        step={0.01}
        value={currentAdjustments.gamma}
        onChange={(value) => handleAdjustmentChange("gamma", value)}
      />

      {/* Red Gain slider */}
      <AdjustmentSlider
        defaultValue={ADJUSTMENT_CONSTRAINTS.redGain.default}
        disabled={isDisabled}
        label="Red Gain"
        max={ADJUSTMENT_CONSTRAINTS.redGain.max}
        min={ADJUSTMENT_CONSTRAINTS.redGain.min}
        step={0.01}
        value={currentAdjustments.redGain}
        onChange={(value) => handleAdjustmentChange("redGain", value)}
      />

      {/* Green Gain slider */}
      <AdjustmentSlider
        defaultValue={ADJUSTMENT_CONSTRAINTS.greenGain.default}
        disabled={isDisabled}
        label="Green Gain"
        max={ADJUSTMENT_CONSTRAINTS.greenGain.max}
        min={ADJUSTMENT_CONSTRAINTS.greenGain.min}
        step={0.01}
        value={currentAdjustments.greenGain}
        onChange={(value) => handleAdjustmentChange("greenGain", value)}
      />

      {/* Blue Gain slider */}
      <AdjustmentSlider
        defaultValue={ADJUSTMENT_CONSTRAINTS.blueGain.default}
        disabled={isDisabled}
        label="Blue Gain"
        max={ADJUSTMENT_CONSTRAINTS.blueGain.max}
        min={ADJUSTMENT_CONSTRAINTS.blueGain.min}
        step={0.01}
        value={currentAdjustments.blueGain}
        onChange={(value) => handleAdjustmentChange("blueGain", value)}
      />

      {/* Action buttons */}
      <div className="flex gap-2 mt-2">
        <Button
          className="flex-1"
          color="default"
          isDisabled={isDisabled}
          size="sm"
          variant="flat"
          onPress={handleReset}
        >
          Reset
        </Button>
        <Button
          className="flex-1"
          color="primary"
          isDisabled={isDisabled}
          size="sm"
          variant="flat"
          onPress={handleAuto}
        >
          Auto
        </Button>
      </div>
    </div>
  );
};
