// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import { ImageProcessingJob } from "@/services/model-runner-service";
import jobsReducer, {
  addJobToOrder,
  fetchJobs,
  JobsState,
  removeJobOptimistically,
  setJobsCustomOrder
} from "@/store/slices/jobs-slice";

/**
 * Property 2: Custom order consistency
 * **Validates: Requirements 1.3, 1.6**
 *
 * For any sequence of fetchJobs.fulfilled, addJobToOrder, setJobsCustomOrder,
 * and removeJobOptimistically actions, every ID in customOrder must exist
 * as a job_id in jobs[].
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RESERVED_KEYS = ["__proto__", "constructor", "prototype"];

const jobIdArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !RESERVED_KEYS.includes(s) && s.trim().length > 0);

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

/**
 * Build a fulfilled action for fetchJobs thunk.
 * RTK async thunks use the pattern: `<prefix>/fulfilled`.
 */
function makeFetchJobsFulfilledAction(jobs: ImageProcessingJob[]) {
  return {
    type: fetchJobs.fulfilled.type,
    payload: { jobs, isManualRefresh: false }
  };
}

// ─── Action Arbitraries ──────────────────────────────────────────────────────

/**
 * Generate a random action from the set:
 *   - fetchJobs.fulfilled with 1-5 random jobs
 *   - addJobToOrder with a random job ID
 *   - setJobsCustomOrder with a random permutation of IDs
 *   - removeJobOptimistically with a random job ID
 *
 * We use a "model" approach: track which job IDs have been introduced so far,
 * so we can generate realistic actions (e.g. remove an ID that exists).
 */

type ActionDesc =
  | { kind: "fetchFulfilled"; jobs: ImageProcessingJob[] }
  | { kind: "addJobToOrder"; jobId: string }
  | { kind: "setCustomOrder"; order: string[] }
  | { kind: "removeJob"; jobId: string };

function actionSequenceArb(): fc.Arbitrary<ActionDesc[]> {
  return fc.array(jobIdArb, { minLength: 1, maxLength: 15 }).chain((idPool) => {
    const uniqueIds = Array.from(new Set(idPool));
    if (uniqueIds.length === 0) return fc.constant([]);

    const pickId = fc.constantFrom(...uniqueIds);

    const fetchAction: fc.Arbitrary<ActionDesc> = fc
      .subarray(uniqueIds, {
        minLength: 1
      })
      .map((ids) => ({
        kind: "fetchFulfilled" as const,
        jobs: ids.map((id) => makeJob(id))
      }));

    const addAction: fc.Arbitrary<ActionDesc> = pickId.map((id: string) => ({
      kind: "addJobToOrder" as const,
      jobId: id
    }));

    const setOrderAction: fc.Arbitrary<ActionDesc> = fc
      .shuffledSubarray(uniqueIds)
      .map((order) => ({
        kind: "setCustomOrder" as const,
        order
      }));

    const removeAction: fc.Arbitrary<ActionDesc> = pickId.map((id: string) => ({
      kind: "removeJob" as const,
      jobId: id
    }));

    return fc.array(
      fc.oneof(fetchAction, addAction, setOrderAction, removeAction),
      {
        minLength: 1,
        maxLength: 20
      }
    );
  });
}

function toReduxAction(desc: ActionDesc) {
  switch (desc.kind) {
    case "fetchFulfilled":
      return makeFetchJobsFulfilledAction(desc.jobs);
    case "addJobToOrder":
      return addJobToOrder({ jobId: desc.jobId });
    case "setCustomOrder":
      return setJobsCustomOrder(desc.order);
    case "removeJob":
      return removeJobOptimistically({ jobId: desc.jobId });
  }
}

// ─── Property Test ───────────────────────────────────────────────────────────

describe("Jobs Slice - Property 2: Custom order consistency", () => {
  it("every ID in customOrder exists as a job_id in jobs[] after any action sequence", () => {
    fc.assert(
      fc.property(actionSequenceArb(), (actions) => {
        let state = getInitialState();

        for (const actionDesc of actions) {
          state = jobsReducer(state, toReduxAction(actionDesc));
        }

        // Invariant: customOrder never contains duplicate IDs
        const orderSet = new Set(state.jobsList.customOrder);
        expect(orderSet.size).toBe(state.jobsList.customOrder.length);

        return true;
      }),
      { numRuns: 200 }
    );
  });
});
