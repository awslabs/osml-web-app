// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Switch } from "@heroui/switch";

import { useAppDispatch, useAppSelector } from "@/store/hooks.ts";
import {
  selectMapSettings,
  toggleMapDayNight
} from "@/store/slices/settings-slice.ts";

export const MapControls = () => {
  const dispatch = useAppDispatch();
  const { dayNightEnabled } = useAppSelector(selectMapSettings);

  return (
    <div className="space-y-3">
      <Switch
        isSelected={dayNightEnabled}
        size="sm"
        onValueChange={() => dispatch(toggleMapDayNight())}
      >
        Day/Night Terminator
      </Switch>
    </div>
  );
};
