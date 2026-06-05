// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { useCallback, useEffect, useRef } from "react";
import { useStore } from "react-redux";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createViewpointForItem,
  pollViewpointStatus,
  selectItemViewpoints,
  selectSearchResults
} from "@/store/slices/data-catalog-slice";
import type { RootState } from "@/store/store";
import { hasViewableImageAsset } from "@/utils/stac-viewpoint-utils";

/**
 * Maximum number of viewpoint creations allowed in flight at once during
 * warming. Caps the burst of concurrent create-viewpoint requests when a
 * search returns many viewable items; remaining items are processed as slots
 * free up.
 */
const MAX_CONCURRENT_WARMING = 4;

/**
 * Hook to automatically warm viewpoints for STAC items with image assets.
 * Processes all items from search results to create viewpoints ahead of time,
 * but with bounded concurrency so a large result set doesn't fire an unbounded
 * burst of parallel create-viewpoint requests.
 */
export const useViewpointWarming = () => {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const searchResults = useAppSelector(selectSearchResults);
  const itemViewpoints = useAppSelector(selectItemViewpoints);

  // Items we've already started warming — dedup across re-renders. Reset when
  // the search result set changes (below).
  const startedRef = useRef<Set<string>>(new Set());
  // Number of create-viewpoint requests currently in flight.
  const inFlightRef = useRef(0);
  // Stable self-reference so a settling task can refill the freed slot without
  // recreating `pump`.
  const pumpRef = useRef<() => void>(() => {});

  // Fill available concurrency slots with the next eligible items. Reads the
  // latest store state directly so async refills see current viewpoints.
  const pump = useCallback(() => {
    while (inFlightRef.current < MAX_CONCURRENT_WARMING) {
      const state = store.getState();
      const viewpoints = selectItemViewpoints(state);
      const next = selectSearchResults(state).features.find(
        (item) =>
          hasViewableImageAsset(item) &&
          !startedRef.current.has(item.id) &&
          !viewpoints[item.id]
      );

      if (!next) break;

      startedRef.current.add(next.id);
      inFlightRef.current += 1;

      void (async () => {
        try {
          const result = await dispatch(createViewpointForItem(next)).unwrap();

          if (result && typeof result === "object" && "viewpointId" in result) {
            dispatch(
              pollViewpointStatus({
                itemId: next.id,
                viewpointId: result.viewpointId as string
              })
            );
          }
        } catch {
          // Error already handled in the Redux slice.
        } finally {
          inFlightRef.current -= 1;
          pumpRef.current();
        }
      })();
    }
  }, [dispatch, store]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  useEffect(() => {
    if (searchResults.loading || searchResults.features.length === 0) {
      return;
    }

    const started = startedRef.current;
    pump();

    // Reset dedup tracking when the search result set changes.
    return () => {
      started.clear();
    };
  }, [searchResults.features, searchResults.loading, pump]);

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
