// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Slider } from "@heroui/slider";

export interface AdjustmentSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

/**
 * A slider component for adjusting image parameters.
 * Displays a label, current value, and slider control.
 * Requirements: 10.4
 */
export const AdjustmentSlider = ({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
  disabled = false
}: AdjustmentSliderProps) => {
  const handleChange = (newValue: number | number[]) => {
    // Slider can return array for range sliders, but we use single value
    const singleValue = Array.isArray(newValue) ? newValue[0] : newValue;
    onChange(singleValue);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-default-500">{value.toFixed(2)}</span>
      </div>
      <Slider
        aria-label={label}
        color="warning"
        defaultValue={defaultValue}
        isDisabled={disabled}
        maxValue={max}
        minValue={min}
        size="sm"
        step={step}
        value={value}
        onChange={handleChange}
      />
    </div>
  );
};
