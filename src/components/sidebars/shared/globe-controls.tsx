// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Switch } from "@heroui/switch";

import { useAppDispatch, useAppSelector } from "@/store/hooks.ts";
import {
  selectGlobeSettings,
  toggleFog,
  toggleGlobeLighting,
  toggleGroundAtmosphere,
  toggleSkyAtmosphere
} from "@/store/slices/settings-slice.ts";

export const GlobeControls = () => {
  const dispatch = useAppDispatch();
  const { enableLighting, showGroundAtmosphere, showSkyAtmosphere, enableFog } =
    useAppSelector(selectGlobeSettings);

  return (
    <div className="flex flex-col gap-3">
      <Switch
        isSelected={enableLighting}
        size="sm"
        onValueChange={() => dispatch(toggleGlobeLighting())}
      >
        Sun Lighting
      </Switch>
      <Switch
        isSelected={showGroundAtmosphere}
        size="sm"
        onValueChange={() => dispatch(toggleGroundAtmosphere())}
      >
        Ground Atmosphere
      </Switch>
      <Switch
        isSelected={showSkyAtmosphere}
        size="sm"
        onValueChange={() => dispatch(toggleSkyAtmosphere())}
      >
        Sky Atmosphere
      </Switch>
      <Switch
        isSelected={enableFog}
        size="sm"
        onValueChange={() => dispatch(toggleFog())}
      >
        Fog
      </Switch>
    </div>
  );
};
