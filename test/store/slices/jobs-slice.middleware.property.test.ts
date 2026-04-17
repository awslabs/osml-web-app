// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import { ImageProcessingJob } from "@/services/model-runner-service";
import {
  fetchDataMiddleware,
  setSelectedJobs
} from "@/store/slices/jobs-slice";

/**
 * Property 7: Middleware triggers on correct action
 * **Validates: Requirements 5.1, 5.2**
 *
 * For any dispatch of setSelectedJobs, the fetchDataMiddleware SHALL invoke
 * fetchGeoJSONData for each job in the payload. For dispatches of any other
 * action, fetchGeoJSONData SHALL NOT be invoked.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJob(jobId: string, status = "SUCCESS"): ImageProcessingJob {
  return {
    job_id: jobId,
    status,
    updated_at: new Date().toISOString()
  };
}

function createMockStore() {
  return {
    dispatch: jest.fn(),
    getState: jest.fn(() => ({}))
  };
}

/**
 * Generate a unique-ID array of 1–6 jobs using uniqueArray.
 * Avoids the jsdom Set-spread issue by letting fast-check handle uniqueness.
 */
const jobsArb: fc.Arbitrary<ImageProcessingJob[]> = fc
  .uniqueArray(
    fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => s.trim().length > 0),
    { minLength: 1, maxLength: 6 }
  )
  .map((ids) => ids.map((id) => makeJob(id)));

/**
 * Arbitrary for generating random non-setSelectedJobs action types.
 * We filter out the actual setSelectedJobs type to ensure we only
 * test "other" actions.
 */
const otherActionTypeArb = fc
  .oneof(
    fc.constant("counter/increment"),
    fc.constant("overlay/addLayer"),
    fc.constant("mapViewer/setViewpointData"),
    fc.constant("jobs/fetchJobs/fulfilled"),
    fc.constant("jobs/fetchJobs/pending"),
    fc.constant("jobs/deleteJob/pending"),
    fc.constant("UNKNOWN_ACTION"),
    fc
      .string({ minLength: 1, maxLength: 40 })
      .filter(
        (s) =>
          s.trim().length > 0 &&
          s !== setSelectedJobs.type &&
          s !== "jobs/setSelectedJobs"
      )
  )
  .filter((t) => t !== setSelectedJobs.type);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Jobs Slice - Property 7: Middleware triggers on correct action", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("dispatches fetchGeoJSONData and fetchViewpointStatus for each job when setSelectedJobs is dispatched", () => {
    fc.assert(
      fc.property(jobsArb, (jobs) => {
        const store = createMockStore();
        const next = jest.fn((action: unknown) => action);

        const middleware = fetchDataMiddleware(store)(next);
        const action = setSelectedJobs(jobs);

        middleware(action);

        // The action must be passed through to next (reducer runs first)
        expect(next).toHaveBeenCalledWith(action);

        // Must dispatch exactly 2 calls per job:
        //   fetchGeoJSONData(job) + fetchViewpointStatus(job.job_id)
        expect(store.dispatch).toHaveBeenCalledTimes(jobs.length * 2);
      }),
      { numRuns: 100 }
    );
  });

  it("does NOT dispatch fetchGeoJSONData for any non-setSelectedJobs action", () => {
    fc.assert(
      fc.property(otherActionTypeArb, (actionType) => {
        const store = createMockStore();
        const next = jest.fn((action: unknown) => action);

        const middleware = fetchDataMiddleware(store)(next);
        const action = { type: actionType, payload: [makeJob("some-job")] };

        middleware(action);

        // The action must still be passed through to next
        expect(next).toHaveBeenCalledWith(action);

        // No dispatches should occur for non-setSelectedJobs actions
        expect(store.dispatch).not.toHaveBeenCalled();
      }),
      { numRuns: 200 }
    );
  });
});
