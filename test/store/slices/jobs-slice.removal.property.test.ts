// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import { ImageProcessingJob } from "@/services/model-runner-service";
import jobsReducer, {
  fetchJobs,
  JobsState,
  removeJobOptimistically,
  setLayerStyle,
  setSelectedJobs,
  VectorStyle
} from "@/store/slices/jobs-slice";

/**
 * Property 3: Optimistic removal completeness
 * **Validates: Requirements 1.7, 3.1**
 *
 * For any call to removeJobOptimistically({ jobId }), after the action is
 * processed: the job ID must be absent from jobs[], customOrder[],
 * selectedJobs[], and layerStyles.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJob(jobId: string, status = "SUCCESS"): ImageProcessingJob {
  return {
    job_id: jobId,
    status,
    updated_at: new Date().toISOString()
  };
}

function getInitialState(): JobsState {
  return jobsReducer(undefined, { type: "@@INIT" });
}

function makeFetchJobsFulfilledAction(jobs: ImageProcessingJob[]) {
  return {
    type: fetchJobs.fulfilled.type,
    payload: { jobs, isManualRefresh: false }
  };
}

const DEFAULT_STYLE: VectorStyle = { color: "#ffaa00", opacity: 0.5 };

// ─── Property Test ───────────────────────────────────────────────────────────

describe("Jobs Slice - Property 3: Optimistic removal completeness", () => {
  it("after removeJobOptimistically, the job ID is absent from jobs[], customOrder[], selectedJobs[], and layerStyles", () => {
    fc.assert(
      fc.property(
        // Number of jobs (1-8)
        fc.integer({ min: 1, max: 8 }),
        // Index of the job to remove
        fc.integer({ min: 0, max: 7 }),
        // Bitmask for which additional jobs to select
        fc.integer({ min: 0, max: 255 }),
        (jobCount, removeIdxRaw, selectionBitmask) => {
          const jobs = Array.from({ length: jobCount }, (_, i) =>
            makeJob(`job-${i}`)
          );
          const removeIdx = removeIdxRaw % jobCount;
          const removeId = jobs[removeIdx].job_id;

          // Step 1: Populate state with jobs via fetchJobs.fulfilled
          let state = getInitialState();
          state = jobsReducer(state, makeFetchJobsFulfilledAction(jobs));

          // Precondition: fetchJobs.fulfilled must have populated the jobs list
          // (This will fail against stubs, making this a proper RED test)
          expect(state.jobsList.jobs).toHaveLength(jobCount);

          // Step 2: Select some jobs — always include the one we'll remove
          const selectedJobs = jobs.filter(
            (_, i) => i === removeIdx || ((selectionBitmask >> i) & 1) === 1
          );
          state = jobsReducer(state, setSelectedJobs(selectedJobs));

          // Step 3: Add layer styles for all selected jobs
          for (const job of selectedJobs) {
            state = jobsReducer(
              state,
              setLayerStyle({ jobId: job.job_id, style: DEFAULT_STYLE })
            );
          }

          // Step 4: Remove the job optimistically
          state = jobsReducer(
            state,
            removeJobOptimistically({ jobId: removeId })
          );

          // Verify: job ID is absent from ALL four state locations
          const jobIds = state.jobsList.jobs.map((j) => j.job_id);
          expect(jobIds).not.toContain(removeId);

          expect(state.jobsList.customOrder).not.toContain(removeId);

          const selectedIds = state.selection.selectedJobs.map((j) => j.job_id);
          expect(selectedIds).not.toContain(removeId);

          expect(state.selection.layerStyles).not.toHaveProperty(removeId);

          return true;
        }
      ),
      { numRuns: 200 }
    );
  });
});
