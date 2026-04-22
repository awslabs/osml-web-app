// Copyright Amazon.com, Inc. or its affiliates.
import { configureStore } from "@reduxjs/toolkit";
import * as fc from "fast-check";

import { ImageProcessingJob } from "@/services/model-runner-service";
import imageryReducer from "@/store/slices/imagery-slice";
import jobsReducer, {
  fetchDataMiddleware,
  setSelectedJobs
} from "@/store/slices/jobs-slice";
import overlayReducer, { addLayer } from "@/store/slices/overlay-slice";

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock("@/services/geojson-cache-service", () => {
  const cache = {
    has: jest.fn(() => false),
    get: jest.fn(() => null),
    set: jest.fn(),
    delete: jest.fn()
  };
  return {
    GeoJSONCacheService: {
      getInstance: () => cache
    }
  };
});

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: { searchItems: jest.fn(() => Promise.resolve({})) }
}));

jest.mock("@/services/s3-service", () => ({
  s3Service: { downloadFile: jest.fn() }
}));

jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: {
    getViewpoint: jest.fn(() => new Promise(() => {})), // Pending forever
    getViewpointExtentWGS84: jest.fn()
  }
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJob(jobId: string, status = "SUCCESS"): ImageProcessingJob {
  return {
    job_id: jobId,
    status,
    updated_at: new Date().toISOString()
  };
}

/**
 * Build a real Redux store wired with the middleware under test. We use a
 * real store (rather than a mock) so that the middleware can read the
 * prev/next selection state from the store as it does in production.
 */
function createRealStore() {
  return configureStore({
    reducer: {
      jobs: jobsReducer,
      overlay: overlayReducer,
      imagery: imageryReducer
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        thunk: true,
        serializableCheck: false
      }).concat(fetchDataMiddleware)
  });
}

/** Object prototype keys that break Immer when used as record keys. */
const PROTO_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));

/** Arbitrary for 1-6 jobs with unique IDs. */
const jobsArb: fc.Arbitrary<ImageProcessingJob[]> = fc
  .uniqueArray(
    fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => s.trim().length > 0 && !PROTO_KEYS.has(s)),
    { minLength: 1, maxLength: 6 }
  )
  .map((ids) => ids.map((id) => makeJob(id)));

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("jobs-slice fetchDataMiddleware — diff-based behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Jobs added to the selection trigger layer fetches. The detection
   * overlay layer is registered by fetchGeoJSONData as a side effect of the
   * middleware running.
   */
  it("registers a detection overlay layer for each job added to selection", () => {
    fc.assert(
      fc.property(jobsArb, (jobs) => {
        const store = createRealStore();

        store.dispatch(setSelectedJobs(jobs));

        const layers = store.getState().overlay.layers;
        for (const job of jobs) {
          expect(layers[`detection-${job.job_id}`]).toBeDefined();
        }
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Jobs removed from the selection have their overlay layers torn down.
   * This is the core fix for the orphaned-layer bug.
   */
  it("removes detection and imagery overlay layers when a job leaves the selection", () => {
    fc.assert(
      fc.property(jobsArb, (jobs) => {
        const store = createRealStore();

        // First, select all jobs so their detection layers get added.
        store.dispatch(setSelectedJobs(jobs));

        // Manually add an imagery overlay for each selected job so we can
        // verify the middleware tears it down too. (In production
        // fetchViewpointStatus creates these asynchronously; here we fake
        // them to avoid waiting.)
        for (const job of jobs) {
          store.dispatch(
            addLayer({
              id: `imagery-${job.job_id}`,
              name: `Imagery: ${job.job_id}`,
              source: "detection",
              zIndex: 5,
              featureCount: 0,
              metadata: { jobId: job.job_id, layerType: "imagery" }
            })
          );
        }

        // Now deselect everything.
        store.dispatch(setSelectedJobs([]));

        const layers = store.getState().overlay.layers;
        for (const job of jobs) {
          expect(layers[`detection-${job.job_id}`]).toBeUndefined();
          expect(layers[`imagery-${job.job_id}`]).toBeUndefined();
        }
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Actions that don't touch selection.selectedJobs don't trigger layer
   * reconciliation. This prevents accidental side effects from unrelated
   * actions.
   */
  it("does not touch overlay layers for unrelated actions", () => {
    const otherActionTypeArb = fc.oneof(
      fc.constant("counter/increment"),
      fc.constant("mapViewer/setViewpointData"),
      fc.constant("UNKNOWN_ACTION")
    );

    fc.assert(
      fc.property(otherActionTypeArb, (actionType) => {
        const store = createRealStore();

        const layersBefore = { ...store.getState().overlay.layers };
        store.dispatch({ type: actionType });
        const layersAfter = store.getState().overlay.layers;

        expect(layersAfter).toEqual(layersBefore);
      }),
      { numRuns: 100 }
    );
  });
});
