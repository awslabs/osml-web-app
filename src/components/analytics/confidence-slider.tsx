// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Slider } from "@heroui/slider";
import React from "react";
import { useDispatch, useSelector } from "react-redux";

import { setConfidenceThreshold } from "@/store/slices/analytics-slice";
import type { RootState } from "@/store/store";

export const ConfidenceSlider: React.FC = () => {
  const dispatch = useDispatch();
  const confidenceThreshold = useSelector(
    (state: RootState) => state.analytics.confidenceThreshold
  );

  const percentage = Math.round(confidenceThreshold * 100);

  const handleChange = (value: number | number[]) => {
    const v = Array.isArray(value) ? value[0] : value;
    dispatch(setConfidenceThreshold(v));
  };

  return (
    <Slider
      aria-label="Confidence Threshold"
      color="warning"
      label="Confidence Threshold"
      maxValue={1}
      minValue={0}
      size="sm"
      step={0.05}
      value={confidenceThreshold}
      onChange={handleChange}
      getValue={() => `${percentage}%`}
    />
  );
};
