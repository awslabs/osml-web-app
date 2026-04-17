// Copyright Amazon.com, Inc. or its affiliates.
import { useRef } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks.ts";
import { setViewport } from "@/store/slices/viewport-slice.ts";

// Custom hook to manage viewport synchronization
export function useViewportSync() {
  const dispatch = useAppDispatch();
  const viewport = useAppSelector((state) => state.viewport);
  const hasInitialized = useRef(false);

  // Get current viewport state (always fresh)
  const getCurrentViewport = () => {
    // This will always return the current Redux state
    return viewport;
  };

  const updateViewport = (
    longitude: number,
    latitude: number,
    zoom: number,
    extent: { west: number; south: number; east: number; north: number },
    source: "map" | "globe"
  ) => {
    dispatch(
      setViewport({
        longitude,
        latitude,
        zoom,
        extent,
        updatedBy: source
      })
    );
  };

  const markAsInitialized = () => {
    hasInitialized.current = true;
  };

  const isInitialized = () => hasInitialized.current;

  return {
    viewport,
    getCurrentViewport,
    updateViewport,
    markAsInitialized,
    isInitialized
  };
}
