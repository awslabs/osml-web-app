// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Property-based tests for job-management delete functionality.
 * Tests partial failure resilience for job deletion operations.
 */

import * as fc from "fast-check";

import { deleteJob, DeleteJobResult } from "@/services/job-management";
import { modelRunnerService } from "@/services/model-runner-service";
import { viewpointService } from "@/services/viewpoint-service";

// Mock the services
jest.mock("@/services/model-runner-service", () => ({
  modelRunnerService: {
    deleteImageProcessingJob: jest.fn()
  }
}));

jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: {
    deleteViewpoint: jest.fn()
  }
}));

jest.mock("@/services/s3-service", () => ({
  s3Service: {
    deleteByPrefix: jest.fn().mockResolvedValue({ deleted: 0 })
  }
}));

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: {
    searchItems: jest.fn().mockResolvedValue({ features: [] }),
    deleteItem: jest.fn().mockResolvedValue(undefined)
  }
}));

describe("Job Management - Property-Based Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Feature: delete-image-processing-job, Property 3: Partial Failure Resilience
   * Validates: Requirements 4.2, 6.3
   *
   * Property: For any job deletion where viewpoint deletion or S3 cleanup fails,
   * the overall deletion operation SHALL still complete successfully and return
   * a result indicating which sub-operations failed.
   */
  describe("Property 3: Partial Failure Resilience", () => {
    it("should succeed when backend succeeds but viewpoint deletion fails", async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), async (jobId) => {
          // Setup: Backend succeeds, viewpoint fails
          (
            modelRunnerService.deleteImageProcessingJob as jest.Mock
          ).mockResolvedValue({
            success: true,
            message: "Job deleted"
          });
          (viewpointService.deleteViewpoint as jest.Mock).mockRejectedValue(
            new Error("Viewpoint not found")
          );

          const result: DeleteJobResult = await deleteJob(jobId);

          // Property: Overall operation should succeed
          expect(result.success).toBe(true);

          // Property: Partial failure should be recorded for viewpoint
          expect(result.partialFailures?.viewpoint).toBeDefined();
          expect(result.partialFailures?.viewpoint).toBe("Viewpoint not found");

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should succeed when backend succeeds regardless of viewpoint failure type", async () => {
      // Arbitrary for different error messages
      const errorMessageArb = fc.string({ minLength: 1, maxLength: 100 });

      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          errorMessageArb,
          async (jobId, errorMsg) => {
            // Setup: Backend succeeds, viewpoint fails with arbitrary error
            (
              modelRunnerService.deleteImageProcessingJob as jest.Mock
            ).mockResolvedValue({
              success: true,
              message: "Job deleted"
            });
            (viewpointService.deleteViewpoint as jest.Mock).mockRejectedValue(
              new Error(errorMsg)
            );

            const result: DeleteJobResult = await deleteJob(jobId);

            // Property: Overall operation should succeed
            expect(result.success).toBe(true);

            // Property: Partial failure should contain the error message
            expect(result.partialFailures?.viewpoint).toBe(errorMsg);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should fail when backend deletion fails, regardless of viewpoint success", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.boolean(),
          async (jobId, viewpointSucceeds) => {
            // Setup: Backend fails
            (
              modelRunnerService.deleteImageProcessingJob as jest.Mock
            ).mockResolvedValue({
              success: false,
              message: "Backend deletion failed"
            });

            if (viewpointSucceeds) {
              (viewpointService.deleteViewpoint as jest.Mock).mockResolvedValue(
                {}
              );
            } else {
              (viewpointService.deleteViewpoint as jest.Mock).mockRejectedValue(
                new Error("Viewpoint error")
              );
            }

            const result: DeleteJobResult = await deleteJob(jobId);

            // Property: Overall operation should fail when backend fails
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should succeed with no partial failures when all operations succeed", async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), async (jobId) => {
          // Setup: All operations succeed
          (
            modelRunnerService.deleteImageProcessingJob as jest.Mock
          ).mockResolvedValue({
            success: true,
            message: "Job deleted"
          });
          (viewpointService.deleteViewpoint as jest.Mock).mockResolvedValue({});

          const result: DeleteJobResult = await deleteJob(jobId);

          // Property: Overall operation should succeed
          expect(result.success).toBe(true);

          // Property: No partial failures should be recorded
          expect(result.partialFailures).toBeUndefined();

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should always attempt viewpoint deletion using job ID", async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), async (jobId) => {
          // Setup: Backend succeeds
          (
            modelRunnerService.deleteImageProcessingJob as jest.Mock
          ).mockResolvedValue({
            success: true,
            message: "Job deleted"
          });
          (viewpointService.deleteViewpoint as jest.Mock).mockResolvedValue({});

          const result: DeleteJobResult = await deleteJob(jobId);

          // Property: Overall operation should succeed
          expect(result.success).toBe(true);

          // Property: Viewpoint service should be called with jobId
          expect(viewpointService.deleteViewpoint).toHaveBeenCalledWith(jobId);

          // Property: No partial failures
          expect(result.partialFailures).toBeUndefined();

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should handle backend throwing exception", async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), async (jobId) => {
          // Setup: Backend throws exception
          (
            modelRunnerService.deleteImageProcessingJob as jest.Mock
          ).mockRejectedValue(new Error("Network error"));
          (viewpointService.deleteViewpoint as jest.Mock).mockResolvedValue({});

          const result: DeleteJobResult = await deleteJob(jobId);

          // Property: Overall operation should fail
          expect(result.success).toBe(false);
          expect(result.error).toBe("Network error");

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
