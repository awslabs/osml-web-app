// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import { ImageProcessingJob } from "@/services/model-runner-service";
import jobsReducer, {
  fetchJobs,
  JobSnapshot,
  JobsState,
  removeJobOptimistically,
  restoreJob,
  setLayerStyle,
  setSelectedJobs,
  VectorStyle
} from "@/store/slices/jobs-slice";

/**
 * Property 4: Restore job round-trip
 * **Validates: Requirements 1.8, 3.3**
 *
 * For any job that is optimistically removed and then restored via
 * `restoreJob(snapshot)`, the job SHALL be present in `state.jobs.jobsList.jobs`,
 * its `job_id` SHALL be in `state.jobs.jobsList.customOrder`, and if
 * `snapshot.wasSelected` is true, the job SHALL be in
 * `state.jobs.selection.selectedJobs`. If `snapshot.layerStyle` is defined,
 * `state.jobs.selection.layerStyles[job.job_id]` SHALL equal it.
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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const HEX_CHARS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f"
];

const vectorStyleArb: fc.Arbitrary<VectorStyle> = fc.record({
  color: fc
    .array(fc.constantFrom(...HEX_CHARS), { minLength: 6, maxLength: 6 })
    .map((chars) => `#${chars.join("")}`),
  opacity: fc.double({ min: 0, max: 1, noNaN: true })
});

// ─── Property Test ───────────────────────────────────────────────────────────

describe("Jobs Slice - Property 4: Restore job round-trip", () => {
  it("after remove + restoreJob(snapshot), the job is present in jobs[] and customOrder[], conditionally in selectedJobs[] and layerStyles", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 0, max: 7 }),
        fc.boolean(),
        fc.boolean(),
        vectorStyleArb,
        fc.integer({ min: 0, max: 255 }),
        (
          jobCount,
          removeIdxRaw,
          wasSelected,
          hasLayerStyle,
          layerStyle,
          otherSelectionBitmask
        ) => {
          const jobs = Array.from({ length: jobCount }, (_, i) =>
            makeJob(`job-${i}`)
          );
          const removeIdx = removeIdxRaw % jobCount;
          const targetJob = jobs[removeIdx];

          // Step 1: Populate state with jobs via fetchJobs.fulfilled
          let state = getInitialState();
          state = jobsReducer(state, makeFetchJobsFulfilledAction(jobs));

          // Precondition: fetchJobs.fulfilled must have populated the jobs list
          expect(state.jobsList.jobs).toHaveLength(jobCount);

          // Step 2: Build selection — include target job if wasSelected
          const selectedJobs = jobs.filter(
            (_, i) =>
              (wasSelected && i === removeIdx) ||
              ((otherSelectionBitmask >> i) & 1) === 1
          );
          state = jobsReducer(state, setSelectedJobs(selectedJobs));

          // Step 3: Set layer style for target job if hasLayerStyle
          if (hasLayerStyle) {
            state = jobsReducer(
              state,
              setLayerStyle({ jobId: targetJob.job_id, style: layerStyle })
            );
          }

          // Step 4: Record the order index before removal
          const orderIndex = state.jobsList.customOrder.indexOf(
            targetJob.job_id
          );

          // Step 5: Build the snapshot before removal
          const snapshot: JobSnapshot = {
            job: targetJob,
            orderIndex: orderIndex >= 0 ? orderIndex : 0,
            wasSelected,
            layerStyle: hasLayerStyle ? layerStyle : undefined
          };

          // Step 6: Remove the job optimistically
          state = jobsReducer(
            state,
            removeJobOptimistically({ jobId: targetJob.job_id })
          );

          // Verify removal happened
          const removedJobIds = state.jobsList.jobs.map((j) => j.job_id);
          expect(removedJobIds).not.toContain(targetJob.job_id);

          // Step 7: Restore the job
          state = jobsReducer(state, restoreJob(snapshot));

          // ─── Verify Property 4 ─────────────────────────────────────

          // 1. Job SHALL be present in jobs[]
          const restoredJobIds = state.jobsList.jobs.map((j) => j.job_id);
          expect(restoredJobIds).toContain(targetJob.job_id);

          // 2. job_id SHALL be in customOrder[]
          expect(state.jobsList.customOrder).toContain(targetJob.job_id);

          // 3. If wasSelected, job SHALL be in selectedJobs[]
          if (wasSelected) {
            const selectedIds = state.selection.selectedJobs.map(
              (j) => j.job_id
            );
            expect(selectedIds).toContain(targetJob.job_id);
          }

          // 4. If layerStyle is defined, layerStyles[job_id] SHALL equal it
          if (hasLayerStyle) {
            expect(state.selection.layerStyles[targetJob.job_id]).toEqual(
              layerStyle
            );
          }

          return true;
        }
      ),
      { numRuns: 200 }
    );
  });
});
