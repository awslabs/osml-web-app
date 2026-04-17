// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import { ImageProcessingJob } from "@/services/model-runner-service";
import jobsReducer, {
  JobSnapshot,
  removeJobOptimistically,
  restoreJob,
  VectorStyle
} from "@/store/slices/jobs-slice";

const RESERVED_OBJECT_KEYS = ["__proto__", "constructor", "prototype"];

const jobIdArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !RESERVED_OBJECT_KEYS.includes(s) && s.trim().length > 0);

function createInitialState() {
  return jobsReducer(undefined, { type: "@@INIT" });
}

function createStateWithJob(
  jobId: string,
  job: ImageProcessingJob,
  options: {
    isSelected?: boolean;
    hasLayerStyle?: boolean;
    layerStyle?: VectorStyle;
  } = {}
) {
  const initialState = createInitialState();
  return {
    ...initialState,
    jobsList: {
      ...initialState.jobsList,
      jobs: [job],
      customOrder: [jobId]
    },
    selection: {
      ...initialState.selection,
      selectedJobs: options.isSelected ? [job] : [],
      layerStyles:
        options.hasLayerStyle && options.layerStyle
          ? { [jobId]: options.layerStyle }
          : {}
    }
  };
}

describe("Jobs Slice - Delete Job Property Tests", () => {
  /**
   * Feature: delete-image-processing-job, Property 1: Redux State Cleanup Completeness
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
   */
  describe("Property 1: Redux State Cleanup Completeness", () => {
    it("should remove job from all state locations", () => {
      fc.assert(
        fc.property(jobIdArb, (jobId: string) => {
          const job: ImageProcessingJob = {
            job_id: jobId,
            status: "SUCCESS",
            updated_at: new Date().toISOString()
          };
          const layerStyle: VectorStyle = { color: "#ff0000", opacity: 0.5 };

          const stateWithJob = createStateWithJob(jobId, job, {
            isSelected: true,
            hasLayerStyle: true,
            layerStyle
          });

          const stateAfterDelete = jobsReducer(
            stateWithJob,
            removeJobOptimistically({ jobId })
          );

          expect(
            stateAfterDelete.jobsList.jobs.some((j) => j.job_id === jobId)
          ).toBe(false);
          expect(stateAfterDelete.jobsList.customOrder.includes(jobId)).toBe(
            false
          );
          expect(
            stateAfterDelete.selection.selectedJobs.some(
              (j) => j.job_id === jobId
            )
          ).toBe(false);
          expect(
            Object.hasOwn(stateAfterDelete.selection.layerStyles, jobId)
          ).toBe(false);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should not affect other jobs when deleting one job", () => {
      fc.assert(
        fc.property(jobIdArb, jobIdArb, (jobId1: string, jobId2: string) => {
          if (jobId1 === jobId2) return true;

          const job1: ImageProcessingJob = {
            job_id: jobId1,
            status: "SUCCESS",
            updated_at: new Date().toISOString()
          };
          const job2: ImageProcessingJob = {
            job_id: jobId2,
            status: "SUCCESS",
            updated_at: new Date().toISOString()
          };

          const initialState = createInitialState();
          const stateWithBothJobs = {
            ...initialState,
            jobsList: {
              ...initialState.jobsList,
              jobs: [job1, job2],
              customOrder: [jobId1, jobId2]
            },
            selection: {
              ...initialState.selection,
              selectedJobs: [job1, job2],
              layerStyles: {
                [jobId1]: { color: "#ff0000", opacity: 0.5 },
                [jobId2]: { color: "#00ff00", opacity: 0.7 }
              }
            }
          };

          const stateAfterDelete = jobsReducer(
            stateWithBothJobs,
            removeJobOptimistically({ jobId: jobId1 })
          );

          expect(
            stateAfterDelete.jobsList.jobs.some((j) => j.job_id === jobId1)
          ).toBe(false);
          expect(
            stateAfterDelete.jobsList.jobs.some((j) => j.job_id === jobId2)
          ).toBe(true);
          expect(
            Object.hasOwn(stateAfterDelete.selection.layerStyles, jobId2)
          ).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: delete-image-processing-job, Property 2: State Restoration on Failure (Round-Trip)
   * **Validates: Requirements 3.6, 8.3**
   */
  describe("Property 2: State Restoration on Failure (Round-Trip)", () => {
    it("should restore job to original state after failed deletion", () => {
      fc.assert(
        fc.property(jobIdArb, (jobId: string) => {
          const job: ImageProcessingJob = {
            job_id: jobId,
            status: "SUCCESS",
            updated_at: new Date().toISOString()
          };
          const layerStyle: VectorStyle = { color: "#ff0000", opacity: 0.5 };

          const originalState = createStateWithJob(jobId, job, {
            isSelected: true,
            hasLayerStyle: true,
            layerStyle
          });

          const orderIndex = originalState.jobsList.customOrder.indexOf(jobId);
          const snapshot: JobSnapshot = {
            job,
            orderIndex,
            wasSelected: true,
            layerStyle
          };

          const stateAfterDelete = jobsReducer(
            originalState,
            removeJobOptimistically({ jobId })
          );
          const stateAfterRestore = jobsReducer(
            stateAfterDelete,
            restoreJob(snapshot)
          );

          expect(
            stateAfterRestore.jobsList.jobs.some((j) => j.job_id === jobId)
          ).toBe(true);
          expect(stateAfterRestore.jobsList.customOrder.includes(jobId)).toBe(
            true
          );
          expect(
            stateAfterRestore.selection.selectedJobs.some(
              (j) => j.job_id === jobId
            )
          ).toBe(true);
          expect(
            Object.hasOwn(stateAfterRestore.selection.layerStyles, jobId)
          ).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should restore job at correct position in order", () => {
      fc.assert(
        fc.property(
          jobIdArb,
          jobIdArb,
          jobIdArb,
          (jobId1: string, jobId2: string, jobId3: string) => {
            if (jobId1 === jobId2 || jobId2 === jobId3 || jobId1 === jobId3)
              return true;

            const job1: ImageProcessingJob = {
              job_id: jobId1,
              status: "SUCCESS",
              updated_at: new Date().toISOString()
            };
            const job2: ImageProcessingJob = {
              job_id: jobId2,
              status: "SUCCESS",
              updated_at: new Date().toISOString()
            };
            const job3: ImageProcessingJob = {
              job_id: jobId3,
              status: "SUCCESS",
              updated_at: new Date().toISOString()
            };

            const initialState = createInitialState();
            const stateWithThreeJobs = {
              ...initialState,
              jobsList: {
                ...initialState.jobsList,
                jobs: [job1, job2, job3],
                customOrder: [jobId1, jobId2, jobId3]
              },
              selection: { ...initialState.selection, selectedJobs: [] }
            };

            const orderIndex = 1;
            const snapshot: JobSnapshot = {
              job: job2,
              orderIndex,
              wasSelected: false
            };

            const stateAfterDelete = jobsReducer(
              stateWithThreeJobs,
              removeJobOptimistically({ jobId: jobId2 })
            );
            const stateAfterRestore = jobsReducer(
              stateAfterDelete,
              restoreJob(snapshot)
            );

            expect(stateAfterRestore.jobsList.customOrder[orderIndex]).toBe(
              jobId2
            );
            expect(stateAfterRestore.jobsList.customOrder).toEqual([
              jobId1,
              jobId2,
              jobId3
            ]);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should not restore selection state if job was not selected", () => {
      fc.assert(
        fc.property(jobIdArb, (jobId: string) => {
          const job: ImageProcessingJob = {
            job_id: jobId,
            status: "SUCCESS",
            updated_at: new Date().toISOString()
          };

          const originalState = createStateWithJob(jobId, job, {
            isSelected: false
          });

          const orderIndex = originalState.jobsList.customOrder.indexOf(jobId);
          const snapshot: JobSnapshot = {
            job,
            orderIndex,
            wasSelected: false
          };

          const stateAfterDelete = jobsReducer(
            originalState,
            removeJobOptimistically({ jobId })
          );
          const stateAfterRestore = jobsReducer(
            stateAfterDelete,
            restoreJob(snapshot)
          );

          expect(
            stateAfterRestore.jobsList.jobs.some((j) => j.job_id === jobId)
          ).toBe(true);
          expect(
            stateAfterRestore.selection.selectedJobs.some(
              (j) => j.job_id === jobId
            )
          ).toBe(false);

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
