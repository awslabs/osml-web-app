// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Shared helpers for computing auto-zoom triggers across the map and globe
 * views.
 *
 * Auto-zoom should fire when a job's detection data transitions from
 * "loading" to "loaded with features" — not when the loading-state overlay
 * record first appears. If auto-zoom fired on the first render (while data
 * was still in flight), the view would have no VectorLayer / GeoJsonDataSource
 * to zoom to, and subsequent renders would see the job as already-tracked,
 * missing the window to zoom once data arrives.
 *
 * By tracking only jobs whose detection layer is present AND not loading
 * AND error-free, the "newly ready" diff fires on the correct render.
 */

import type { OverlayLayer } from "@/store/slices/overlay-slice";

/**
 * Compute the set of job IDs whose detection (vector) data is currently
 * loaded and therefore safe to zoom to.
 *
 * Filters strictly on `layerType === "vector"` to distinguish the vector
 * detection layer from its sibling imagery tile layer — both use the
 * `"detection"` source type today but represent very different data.
 */
export function computeLoadedDetectionJobIds(
  overlayLayers: Record<string, OverlayLayer>
): Set<string> {
  const result = new Set<string>();
  for (const layer of Object.values(overlayLayers)) {
    if (
      layer.source === "detection" &&
      layer.metadata?.layerType === "vector" &&
      layer.metadata?.jobId &&
      !layer.metadata.loading &&
      !layer.metadata.error
    ) {
      result.add(layer.metadata.jobId);
    }
  }
  return result;
}

/**
 * Given the currently-loaded set and the previously-loaded set, return the
 * job IDs that are newly loaded this render. The caller is expected to
 * update its "previous" reference to the current set after acting on the
 * diff.
 */
export function diffNewlyLoaded(
  currentLoaded: ReadonlySet<string>,
  previousLoaded: ReadonlySet<string>
): Set<string> {
  const added = new Set<string>();
  currentLoaded.forEach((id) => {
    if (!previousLoaded.has(id)) {
      added.add(id);
    }
  });
  return added;
}
