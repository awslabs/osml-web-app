// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Select, SelectItem } from "@heroui/select";
import type { SharedSelection } from "@heroui/system";
import React from "react";
import { useDispatch, useSelector } from "react-redux";

import { setColorMode } from "@/store/slices/analytics-slice";
import type { RootState } from "@/store/store";
import type { ColorMode } from "@/utils/analytics/types";

const OPTIONS: { value: ColorMode; label: string }[] = [
  { value: "layer", label: "By Layer" },
  { value: "confidence", label: "By Confidence" },
  { value: "classification", label: "By Classification" }
];

export const ColorModeSelector: React.FC = () => {
  const dispatch = useDispatch();
  const colorMode = useSelector(
    (state: RootState) => state.analytics.colorMode
  );

  const handleSelectionChange = (keys: SharedSelection) => {
    const selected = keys === "all" ? undefined : Array.from(keys)[0];
    if (selected) {
      dispatch(setColorMode(String(selected) as ColorMode));
    }
  };

  return (
    <Select
      aria-label="Color mode"
      className="w-full"
      label="Color Mode"
      selectedKeys={[colorMode]}
      size="sm"
      variant="flat"
      onSelectionChange={handleSelectionChange}
    >
      {OPTIONS.map((opt) => (
        <SelectItem key={opt.value} textValue={opt.label}>
          {opt.label}
        </SelectItem>
      ))}
    </Select>
  );
};
