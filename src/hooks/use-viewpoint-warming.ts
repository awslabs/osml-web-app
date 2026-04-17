// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { useEffect, useRef } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createViewpointForItem,
  pollViewpointStatus,
  selectItemViewpoints,
  selectSearchResults
} from "@/store/slices/data-catalog-slice";
import { hasViewableImageAsset } from "@/utils/stac-viewpoint-utils";

/**
 * Hook to automatically warm viewpoints for STAC items with image assets
 * Processes all items from search results to create viewpoints ahead of time
 */
export const useViewpointWarming = () => {
  const dispatch = useAppDispatch();
  const searchResults = useAppSelector(selectSearchResults);
  const itemViewpoints = useAppSelector(selectItemViewpoints);

  // Track which items we've already processed to avoid duplicates
  const processedItems = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (searchResults.loading || searchResults.features.length === 0) {
      return;
    }

    // Capture ref value for cleanup
    const currentProcessedItems = processedItems.current;

    // Process all items with viewable image assets
    const itemsToWarm = searchResults.features.filter((item) =>
      hasViewableImageAsset(item)
    );

    itemsToWarm.forEach(async (item) => {
      // Skip if already processed or already has viewpoint
      if (currentProcessedItems.has(item.id) || itemViewpoints[item.id]) {
        return;
      }

      // Mark as processed
      currentProcessedItems.add(item.id);

      try {
        // Create viewpoint
        const result = await dispatch(createViewpointForItem(item)).unwrap();

        if (result && typeof result === "object" && "viewpointId" in result) {
          // Start polling for status
          dispatch(
            pollViewpointStatus({
              itemId: item.id,
              viewpointId: result.viewpointId as string
            })
          );
        }
      } catch {
        // Error already handled in Redux slice
        // Silently handle to avoid console noise during warming
      }
    });

    // Clear processed items when search results change
    return () => {
      currentProcessedItems.clear();
    };
  }, [searchResults.features, searchResults.loading, dispatch, itemViewpoints]);

  return {
    isWarming: Object.values(itemViewpoints).some(
      (vp) => vp.status === "creating"
    ),
    readyCount: Object.values(itemViewpoints).filter(
      (vp) => vp.status === "ready"
    ).length,
    errorCount: Object.values(itemViewpoints).filter(
      (vp) => vp.status === "error"
    ).length
  };
};
