// Copyright Amazon.com, Inc. or its affiliates.
import type { FeatureCollection } from "geojson";
import { useEffect, useState } from "react";

import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import { useAppSelector } from "@/store/hooks";

/**
 * Custom hook for views to consume overlay layer data reactively.
 *
 * For inline layers (agent/user), builds a FeatureCollection from Redux state.
 * For cached layers (detection/stac), reads from GeoJSONCacheService and
 * subscribes to cache changes to trigger re-renders.
 *
 * @param layerId - The overlay layer ID to read data for
 * @returns GeoJSON FeatureCollection or null if no data available
 */
export function useOverlayLayerData(layerId: string): FeatureCollection | null {
  const layer = useAppSelector((state) => state.overlay.layers[layerId]);
  const inlineFeatures = useAppSelector(
    (state) => state.overlay.inlineFeatures[layerId]
  );
  const cache = GeoJSONCacheService.getInstance();
  const [cacheVersion, setCacheVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = cache.subscribe(layerId, () => {
      setCacheVersion((v) => v + 1);
    });
    return unsubscribe;
  }, [layerId, cache]);

  // For inline layers (agent/user), build FeatureCollection from Redux state
  if (layer?.source === "agent" || layer?.source === "user") {
    if (!inlineFeatures || inlineFeatures.length === 0) return null;
    return { type: "FeatureCollection", features: inlineFeatures };
  }

  // For cached layers (detection/stac), read from cache
  // cacheVersion is used to trigger re-renders when cache data changes
  void cacheVersion;
  return cache.get(layerId);
}
