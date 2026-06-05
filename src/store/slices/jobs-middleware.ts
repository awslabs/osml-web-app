// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Diff-based middleware that turns job-selection changes into rendered
 * overlay layers. Split out of `jobs-slice.ts`; depends on the slice (for the
 * `removeJobOptimistically` action type) and the thunks, never the reverse.
 */
import { AnyAction, Middleware } from "@reduxjs/toolkit";

import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import { RootState } from "@/store/store.ts";

import { removeViewpointData } from "./imagery-slice";
import { removeJobOptimistically } from "./jobs-core";
import {
  deleteJob,
  fetchGeoJSONData,
  fetchViewpointStatus
} from "./jobs-thunks";
import { removeLayer } from "./overlay-slice";

/**
 * Actions that represent a "full delete" of a job (as opposed to a simple
 * deselection). When a full delete occurs, the middleware additionally
 * clears the GeoJSON cache entry and the viewpoint data — state a simple
 * deselect should preserve for instant re-selection.
 */
const FULL_DELETE_ACTION_TYPES: ReadonlySet<string> = new Set([
  removeJobOptimistically.type,
  deleteJob.pending.type
]);

/**
 * Diff-based middleware: every action that mutates
 * `state.jobs.selection.selectedJobs` triggers layer reconciliation.
 *
 * - Jobs newly added to the selection → dispatch `fetchGeoJSONData` and
 *   `fetchViewpointStatus` to load (or re-register from cache) detection
 *   and imagery overlay layers.
 * - Jobs removed from the selection → tear down the matching overlay
 *   layers. For simple deselections, viewpoint data and the GeoJSON cache
 *   are preserved so that re-selection is instant. For deletions, the
 *   viewpoint data and cache are also cleared so no stale data remains.
 *
 * This is the single authoritative path from "user intent" (selection) to
 * "rendered layers". The views are pure projections of `overlay.layers`
 * and `imagery.viewpointData`.
 */
export const fetchDataMiddleware: Middleware =
  (store) => (next) => (action) => {
    const typedAction = action as { type?: string };
    const prevSelectedJobs = (store.getState() as RootState).jobs.selection
      .selectedJobs;

    const result = next(action);

    const nextSelectedJobs = (store.getState() as RootState).jobs.selection
      .selectedJobs;

    // No-op if selection didn't change.
    if (prevSelectedJobs === nextSelectedJobs) {
      return result;
    }

    const prevIds = new Set(prevSelectedJobs.map((j) => j.job_id));
    const nextIds = new Set(nextSelectedJobs.map((j) => j.job_id));

    const added = nextSelectedJobs.filter((j) => !prevIds.has(j.job_id));
    const removed = prevSelectedJobs.filter((j) => !nextIds.has(j.job_id));

    if (added.length === 0 && removed.length === 0) {
      return result;
    }

    const cache = GeoJSONCacheService.getInstance();
    const isFullDelete =
      typeof typedAction.type === "string" &&
      FULL_DELETE_ACTION_TYPES.has(typedAction.type);

    for (const job of added) {
      store.dispatch(fetchGeoJSONData(job) as unknown as AnyAction);
      store.dispatch(fetchViewpointStatus(job.job_id) as unknown as AnyAction);
    }

    for (const job of removed) {
      const detectionLayerId = `detection-${job.job_id}`;
      const imageryLayerId = `imagery-${job.job_id}`;

      store.dispatch(removeLayer(detectionLayerId));
      store.dispatch(removeLayer(imageryLayerId));

      if (isFullDelete) {
        // Clear cache and viewpoint data. Simple deselections preserve
        // these for instant re-selection; deletions discard them.
        cache.delete(detectionLayerId);
        store.dispatch(removeViewpointData({ jobId: job.job_id }));
      }
    }

    return result;
  };
