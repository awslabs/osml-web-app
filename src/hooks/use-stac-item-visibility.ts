// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import type { StacItem } from "stac-ts";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectItemViewpoints,
  selectSearchResults,
  selectVisibleItems,
  toggleItemVisibility
} from "@/store/slices/data-catalog-slice";
import {
  addFeature,
  GeoJSONFeature,
  removeFeature
} from "@/store/slices/overlay-slice";

/**
 * Custom hook to handle STAC item visibility toggling
 */
export const useStacItemVisibility = () => {
  const dispatch = useAppDispatch();
  const searchResults = useAppSelector(selectSearchResults);
  const visibleItems = useAppSelector(selectVisibleItems);
  const itemViewpoints = useAppSelector(selectItemViewpoints);

  const createStacFeature = (item: StacItem) => {
    const stacUrl = `/collections/${item.collection}/items/${item.id}`;
    const viewpoint = itemViewpoints[item.id];
    const hasImagery = viewpoint !== undefined;

    return {
      type: "Feature" as const,
      id: `stac-${item.id}`,
      geometry: item.geometry!,
      properties: {
        ...item.properties,
        description: `STAC Item: ${item.properties?.title || item.id}`,
        dataSource: "stac_url",
        stacUrl: stacUrl,
        createdBy: "user" as const,
        createdAt: new Date().toISOString(),
        // Include viewpoint information if available
        viewpointId: viewpoint?.viewpointId,
        viewpointStatus: viewpoint?.status,
        hasImagery: hasImagery,
        style: {
          color: "#3388ff",
          fillColor: "#3388ff",
          fillOpacity: hasImagery ? 0 : 0.3, // No fill for items with viewpoints
          opacity: 0.8,
          weight: 2
        }
      }
    } as GeoJSONFeature;
  };

  const handleToggleVisibility = (itemId: string, providedItem?: StacItem) => {
    const isCurrentlyVisible = visibleItems.includes(itemId);

    if (isCurrentlyVisible) {
      // Remove from map and visibility tracking
      dispatch(toggleItemVisibility(itemId));
      dispatch(
        removeFeature({ featureId: `stac-${itemId}`, updatedBy: "user" })
      );
    } else {
      // Add to map and visibility tracking
      dispatch(toggleItemVisibility(itemId));

      // Find item from search results or use provided item
      const item =
        providedItem || searchResults.features.find((f) => f.id === itemId);

      if (item) {
        const feature = createStacFeature(item);

        dispatch(addFeature({ feature, updatedBy: "user" }));
      }
    }
  };

  const isItemVisible = (itemId: string) => {
    return visibleItems.includes(itemId);
  };

  return {
    handleToggleVisibility,
    isItemVisible,
    visibleItems,
    itemViewpoints
  };
};
