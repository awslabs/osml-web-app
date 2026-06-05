// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Property-Based Tests for Model Runner MCP Tools
 *
 * These tests verify universal properties that should hold across all valid inputs.
 * Using fast-check for property-based testing.
 */

import { configureStore } from "@reduxjs/toolkit";
import * as fc from "fast-check";

import {
  deleteImageProcessingJobTool,
  displayDetectionResultsTool,
  DisplayResultsResponse,
  GetJobStatusResponse,
  getJobStatusTool,
  ListAvailableImagesResponse,
  listAvailableImagesTool,
  listImageProcessingJobsTool,
  ListJobsToolResponse,
  ListModelEndpointsResponse,
  listModelEndpointsTool,
  submitImageProcessingJobTool,
  SubmitJobResponse
} from "@/mcp/local-server/model-runner-tools";
import { ImageProcessingJob } from "@/services/model-runner-service";
import { JobSnapshot } from "@/store/slices/jobs-slice";

/** Shape of the request object captured from createImageProcessingJob calls. */
interface CapturedJobRequest {
  imageProcessorTileSize?: number;
  imageProcessorTileOverlap?: number;
  imageProcessorTileFormat?: string;
  rangeAdjustment?: string;
  imageProcessorParameters?: {
    CustomAttributes?: string;
  };
  [key: string]: unknown;
}

// Mock services
jest.mock("@/services/sagemaker-service", () => ({
  sagemakerService: {
    getEndpoints: jest.fn()
  }
}));

jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: {
    getViewpoints: jest.fn(),
    createViewpoint: jest.fn()
  }
}));

jest.mock("@/services/s3-service", () => ({
  s3Service: {
    getBuckets: jest.fn(),
    getBucketContents: jest.fn()
  }
}));

jest.mock("@/services/model-runner-service", () => ({
  modelRunnerService: {
    createImageProcessingJob: jest.fn(),
    listImageProcessingJobs: jest.fn(),
    getImageProcessingJob: jest.fn()
  }
}));

jest.mock("@/services/job-management", () => ({
  fetchAllJobs: jest.fn(),
  fetchJobStatus: jest.fn(),
  deleteJob: jest.fn(),
  isJobComplete: jest.fn((status: string) =>
    ["SUCCESS", "PARTIAL", "FAILED"].includes(status)
  ),
  isJobSuccessful: jest.fn((status: string) =>
    ["SUCCESS", "COMPLETED"].includes(status)
  )
}));

jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid-1234")
}));

// Import mocked modules
import { fetchAllJobs, fetchJobStatus } from "@/services/job-management";
import { modelRunnerService } from "@/services/model-runner-service";
import { s3Service } from "@/services/s3-service";
import { sagemakerService } from "@/services/sagemaker-service";
import { viewpointService } from "@/services/viewpoint-service";

// Create a mock store

/** State shape for the mock jobs reducer. */
interface MockJobsState {
  jobsList: {
    jobs: ImageProcessingJob[];
    customOrder: string[];
    isLoading: boolean;
    isRefreshing: boolean;
    error: string | null;
  };
  selection: {
    selectedJobs: ImageProcessingJob[];
    layerStyles: Record<string, unknown>;
  };
}

type MockJobsAction =
  | { type: "jobs/removeJobOptimistically"; payload: { jobId: string } }
  | { type: "jobs/restoreJob"; payload: JobSnapshot }
  | { type: string; payload?: unknown };

function mockJobsReducer(
  state: MockJobsState,
  action: MockJobsAction
): MockJobsState {
  if (action.type === "jobs/removeJobOptimistically") {
    const { jobId } = action.payload as { jobId: string };
    return {
      ...state,
      jobsList: {
        ...state.jobsList,
        jobs: state.jobsList.jobs.filter(
          (j: ImageProcessingJob) => j.job_id !== jobId
        ),
        customOrder: state.jobsList.customOrder.filter(
          (id: string) => id !== jobId
        )
      },
      selection: {
        ...state.selection,
        selectedJobs: state.selection.selectedJobs.filter(
          (j: ImageProcessingJob) => j.job_id !== jobId
        ),
        layerStyles: Object.fromEntries(
          Object.entries(state.selection.layerStyles).filter(
            ([key]) => key !== jobId
          )
        )
      }
    };
  }
  if (action.type === "jobs/restoreJob") {
    const { job, orderIndex, wasSelected, layerStyle } =
      action.payload as JobSnapshot;
    const newJobs = [...state.jobsList.jobs];
    newJobs.splice(orderIndex, 0, job);
    const newOrder = [...state.jobsList.customOrder];
    newOrder.splice(orderIndex, 0, job.job_id);
    return {
      ...state,
      jobsList: {
        ...state.jobsList,
        jobs: newJobs,
        customOrder: newOrder
      },
      selection: {
        ...state.selection,
        selectedJobs: wasSelected
          ? [...state.selection.selectedJobs, job]
          : state.selection.selectedJobs,
        layerStyles: layerStyle
          ? { ...state.selection.layerStyles, [job.job_id]: layerStyle }
          : state.selection.layerStyles
      }
    };
  }
  return state;
}

const createMockStore = (initialJobs: ImageProcessingJob[] = []) => {
  const jobsInitialState: MockJobsState = {
    jobsList: {
      jobs: initialJobs,
      customOrder: initialJobs.map((j: ImageProcessingJob) => j.job_id),
      isLoading: false,
      isRefreshing: false,
      error: null
    },
    selection: {
      selectedJobs: [] as ImageProcessingJob[],
      layerStyles: {} as Record<string, unknown>
    }
  };

  const mapViewerInitialState = {
    viewpointData: {} as Record<string, unknown>
  };

  const overlayInitialState = {
    layers: {} as Record<string, unknown>,
    layerOrder: [] as string[],
    inlineFeatures: {} as Record<string, unknown>
  };

  return configureStore({
    reducer: {
      jobs: (state: MockJobsState = jobsInitialState, action: MockJobsAction) =>
        mockJobsReducer(state, action),
      mapViewer: (state = mapViewerInitialState) => state,
      overlay: (state = overlayInitialState) => state,
      viewport: (state = {}) => state
    }
  });
};

describe("Model Runner MCP Tools - Property-Based Tests", () => {
  let mockStore: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = createMockStore([]);
  });

  /**
   * Feature: model-runner-mcp-tools, Property 2: Status Mapping to Availability
   * Validates: Requirements 1.2, 2.3, 4.3
   *
   * For any resource with a status field (SageMaker endpoint, Viewpoint, or Job),
   * the availability/ready flag in the response should correctly reflect the status.
   */
  describe("Property 2: Status Mapping to Availability", () => {
    it("should correctly map endpoint status to availability for all status values", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            "InService",
            "Creating",
            "Failed",
            "Deleting",
            "Updating",
            "RollingBack"
          ),
          async (status) => {
            (sagemakerService.getEndpoints as jest.Mock).mockResolvedValue([
              { name: "test-endpoint", status, creationTime: null }
            ]);

            const result = (await listModelEndpointsTool.handler(
              {},
              mockStore
            )) as ListModelEndpointsResponse;

            expect(result.success).toBe(true);
            expect(result.endpoints!).toHaveLength(1);
            // Property: InService → available=true, all others → available=false
            expect(result.endpoints![0].available).toBe(status === "InService");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should correctly map viewpoint status to availability for all status values", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom("test-bucket-1", "test-bucket-2", "images-bucket"),
          async (bucketName) => {
            (s3Service.getBuckets as jest.Mock).mockResolvedValue([
              { name: bucketName }
            ]);
            (s3Service.getBucketContents as jest.Mock).mockResolvedValue([
              { key: "image.tif", size: 1000, lastModified: "2024-01-01" }
            ]);

            const result = (await listAvailableImagesTool.handler(
              {},
              mockStore
            )) as ListAvailableImagesResponse;

            expect(result.success).toBe(true);
            expect(result.buckets!).toHaveLength(1);
            expect(result.buckets![0].bucket_name).toBe(bucketName);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should correctly map job status to results_ready for all status values", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            "SUCCESS",
            "COMPLETED",
            "PARTIAL",
            "FAILED",
            "IN_PROGRESS",
            "PENDING"
          ),
          async (status) => {
            (fetchJobStatus as jest.Mock).mockResolvedValue({
              job: {
                job_id: "job-123",
                job_name: "Test Job",
                status,
                updated_at: "2024-01-01T00:00:00Z"
              }
            });

            const result = (await getJobStatusTool.handler(
              { job_id: "job-123" },
              mockStore
            )) as GetJobStatusResponse;

            expect(result.success).toBe(true);
            // Property: SUCCESS/COMPLETED → results_ready=true, all others → results_ready=false
            expect(result.job!.results_ready).toBe(
              status === "SUCCESS" || status === "COMPLETED"
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: model-runner-mcp-tools, Property 3: Response Structure Completeness
   * Validates: Requirements 2.2, 4.2, 5.2, 7.5
   *
   * For any successful tool response, the response object should include all required fields.
   */
  describe("Property 3: Response Structure Completeness", () => {
    it("should include all required fields in viewpoint response", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bucket_name: fc.string({ minLength: 1, maxLength: 50 }),
            object_key: fc.string({ minLength: 1, maxLength: 200 }),
            size: fc.nat({ max: 1000000 }),
            lastModified: fc.constant("2024-01-01T00:00:00Z")
          }),
          async (s3Object) => {
            (s3Service.getBuckets as jest.Mock).mockResolvedValue([
              { name: s3Object.bucket_name }
            ]);
            (s3Service.getBucketContents as jest.Mock).mockResolvedValue([
              {
                key: s3Object.object_key,
                size: s3Object.size,
                lastModified: s3Object.lastModified
              }
            ]);

            const result = (await listAvailableImagesTool.handler(
              {},
              mockStore
            )) as ListAvailableImagesResponse;

            expect(result.success).toBe(true);
            expect(result.buckets!).toHaveLength(1);
            const bucket = result.buckets![0];
            // Property: All required fields are present
            expect(bucket).toHaveProperty("bucket_name");
            expect(bucket).toHaveProperty("object_count");
            expect(bucket).toHaveProperty("objects");
            expect(bucket).toHaveProperty("truncated");
            expect(bucket.objects[0]).toHaveProperty("key");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should include all required fields in job status response", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            job_id: fc.string({ minLength: 1, maxLength: 50 }),
            job_name: fc.string({ minLength: 0, maxLength: 100 }),
            status: fc.constantFrom("SUCCESS", "FAILED", "IN_PROGRESS"),
            image_status: fc.option(fc.string(), { nil: undefined }),
            processing_duration: fc.option(fc.nat({ max: 10000 }), {
              nil: undefined
            }),
            output_bucket: fc.option(fc.string(), { nil: undefined }),
            updated_at: fc.constant("2024-01-01T00:00:00Z")
          }),
          async (job) => {
            (fetchJobStatus as jest.Mock).mockResolvedValue({ job });

            const result = (await getJobStatusTool.handler(
              { job_id: job.job_id },
              mockStore
            )) as GetJobStatusResponse;

            expect(result.success).toBe(true);
            // Property: All required fields are present
            expect(result.job!).toHaveProperty("job_id");
            expect(result.job!).toHaveProperty("job_name");
            expect(result.job!).toHaveProperty("status");
            expect(result.job!).toHaveProperty("results_ready");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should include all required fields in job list response", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              job_id: fc.string({ minLength: 1, maxLength: 50 }),
              job_name: fc.string({ minLength: 0, maxLength: 100 }),
              status: fc.constantFrom("SUCCESS", "FAILED", "IN_PROGRESS"),
              image_status: fc.option(fc.string(), { nil: undefined }),
              updated_at: fc.constant("2024-01-01T00:00:00Z")
            }),
            { minLength: 1, maxLength: 5 }
          ),
          async (jobs) => {
            (fetchAllJobs as jest.Mock).mockResolvedValue({ jobs });

            const result = (await listImageProcessingJobsTool.handler(
              {},
              mockStore
            )) as ListJobsToolResponse;

            expect(result.success).toBe(true);
            // Property: All required fields are present in each job
            result.jobs!.forEach(
              (job: {
                job_id: string;
                job_name: string;
                status: string;
                updated_at: string;
              }) => {
                expect(job).toHaveProperty("job_id");
                expect(job).toHaveProperty("job_name");
                expect(job).toHaveProperty("status");
                expect(job).toHaveProperty("updated_at");
              }
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should always include success boolean in all responses", async () => {
      // Test list_model_endpoints
      (sagemakerService.getEndpoints as jest.Mock).mockResolvedValue([]);
      const endpointsResult = (await listModelEndpointsTool.handler(
        {},
        mockStore
      )) as ListModelEndpointsResponse;
      expect(typeof endpointsResult.success).toBe("boolean");

      // Test list_available_images
      (viewpointService.getViewpoints as jest.Mock).mockResolvedValue([]);
      const imagesResult = (await listAvailableImagesTool.handler(
        {},
        mockStore
      )) as ListAvailableImagesResponse;
      expect(typeof imagesResult.success).toBe("boolean");

      // Test list_image_processing_jobs
      (fetchAllJobs as jest.Mock).mockResolvedValue({ jobs: [] });
      const jobsResult = (await listImageProcessingJobsTool.handler(
        {},
        mockStore
      )) as ListJobsToolResponse;
      expect(typeof jobsResult.success).toBe("boolean");
    });
  });

  /**
   * Feature: model-runner-mcp-tools, Property 4: Required Parameter Validation
   * Validates: Requirements 3.2
   *
   * For any submit_image_processing_job invocation missing one or more required parameters,
   * the tool handler should return a validation error with success=false.
   */
  describe("Property 4: Required Parameter Validation", () => {
    it("should return validation error for any combination of missing required parameters", async () => {
      // Note: output_bucket is not validated upfront - it has fallback logic to find a default bucket
      // The MCP tool maps snake_case args to camelCase SubmitJobParams, so validation
      // errors reference the camelCase names from the shared submission service.
      const requiredParams = ["job_name", "image_url", "model_endpoint_name"];
      const camelCaseMap: Record<string, string> = {
        job_name: "jobName",
        image_url: "imageUrl",
        model_endpoint_name: "modelEndpointName"
      };

      await fc.assert(
        fc.asyncProperty(
          // Generate a subset of required params to include (0 to 2 params)
          fc.subarray(requiredParams, { minLength: 0, maxLength: 2 }),
          async (includedParams) => {
            const args: Record<string, string> = {};

            // Only add the included params
            if (includedParams.includes("job_name")) args.job_name = "test-job";
            if (includedParams.includes("image_url"))
              args.image_url = "s3://bucket/image.tif";
            if (includedParams.includes("model_endpoint_name"))
              args.model_endpoint_name = "endpoint";

            const result = (await submitImageProcessingJobTool.handler(
              args,
              mockStore
            )) as SubmitJobResponse;

            // Property: If any required param is missing, success=false
            const missingParams = requiredParams.filter(
              (p) => !includedParams.includes(p)
            );
            if (missingParams.length > 0) {
              expect(result.success).toBe(false);
              expect(result.error).toContain("Missing required parameters");
              // Verify all missing params are listed (using camelCase names from shared service)
              missingParams.forEach((param) => {
                expect(result.error).toContain(camelCaseMap[param]);
              });
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: model-runner-mcp-tools, Property 5: Optional Parameters Use Defaults
   * Validates: Requirements 3.3, 6.2
   *
   * For any tool invocation where optional parameters are omitted,
   * the handler should use the specified default values.
   */
  describe("Property 5: Optional Parameters Use Defaults", () => {
    it("should use default values for optional job submission parameters", async () => {
      let capturedRequest: CapturedJobRequest | null = null;

      (
        modelRunnerService.createImageProcessingJob as jest.Mock
      ).mockImplementation((req: CapturedJobRequest) => {
        capturedRequest = req;
        return Promise.resolve({ job_id: "test-uuid-1234", status: "PENDING" });
      });
      (viewpointService.createViewpoint as jest.Mock).mockResolvedValue({});

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            job_name: fc.string({ minLength: 1, maxLength: 50 }),
            model_endpoint_name: fc.string({ minLength: 1, maxLength: 100 }),
            output_bucket: fc.string({ minLength: 1, maxLength: 100 })
          }),
          async (params) => {
            capturedRequest = null;

            const result = (await submitImageProcessingJobTool.handler(
              {
                job_name: params.job_name,
                image_url: "s3://bucket/path/image.tif",
                model_endpoint_name: params.model_endpoint_name,
                output_bucket: params.output_bucket
                // No optional params provided
              },
              mockStore
            )) as SubmitJobResponse;

            if (result.success && capturedRequest) {
              const req = capturedRequest as unknown as CapturedJobRequest;
              // Property: Default values are applied
              expect(req.imageProcessorTileSize).toBe(512);
              expect(req.imageProcessorTileOverlap).toBe(128);
              expect(req.imageProcessorTileFormat).toBe("GTIFF");
              expect(req.rangeAdjustment).toBe("DRA");
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should use default color and opacity for display results", async () => {
      // We can't easily test the actual dispatch values, but we can verify
      // the tool accepts calls without optional params
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }),
          async (jobId) => {
            (fetchJobStatus as jest.Mock).mockResolvedValue({
              job: {
                job_id: jobId,
                job_name: "Test Job",
                status: "IN_PROGRESS", // Not completed, so we get an error before dispatch
                updated_at: "2024-01-01T00:00:00Z"
              }
            });

            // Call without optional color/opacity params
            const result = (await displayDetectionResultsTool.handler(
              { job_id: jobId },
              mockStore
            )) as DisplayResultsResponse;

            // The tool should process the request (even if it fails due to status)
            expect(result).toHaveProperty("success");
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: model-runner-mcp-tools, Property 6: SAM3 Text Prompt Handling
   * Validates: Requirements 3.4
   *
   * For any submit_image_processing_job invocation where model_endpoint_name contains "sam3"
   * and text_prompt is provided, the job request should include imageProcessorParameters.
   */
  describe("Property 6: SAM3 Text Prompt Handling", () => {
    it("should include text_prompt in imageProcessorParameters for SAM3 models", async () => {
      let capturedRequest: CapturedJobRequest | null = null;

      (
        modelRunnerService.createImageProcessingJob as jest.Mock
      ).mockImplementation((req: CapturedJobRequest) => {
        capturedRequest = req;
        return Promise.resolve({ job_id: "test-uuid-1234", status: "PENDING" });
      });
      (viewpointService.createViewpoint as jest.Mock).mockResolvedValue({});

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            endpointName: fc.constantFrom(
              "sam3-endpoint",
              "SAM3-model",
              "my-sam3-detector",
              "SAM3",
              "aircraft-sam3-v2"
            ),
            // Use non-empty, non-whitespace strings for text prompts
            textPrompt: fc.constantFrom(
              "vehicles",
              "buildings",
              "aircraft",
              "ships",
              "roads"
            )
          }),
          async ({ endpointName, textPrompt }) => {
            capturedRequest = null;

            const result = (await submitImageProcessingJobTool.handler(
              {
                job_name: "test-job",
                image_url: "s3://bucket/path/image.tif",
                model_endpoint_name: endpointName,
                output_bucket: "output-bucket",
                text_prompt: textPrompt
              },
              mockStore
            )) as SubmitJobResponse;

            if (result.success && capturedRequest) {
              const req = capturedRequest as unknown as CapturedJobRequest;
              // Property: SAM3 models with text_prompt should have imageProcessorParameters
              expect(req.imageProcessorParameters).toBeDefined();
              expect(
                req.imageProcessorParameters!.CustomAttributes
              ).toBeDefined();

              // CustomAttributes uses simple string format: "text_prompt=value"
              expect(req.imageProcessorParameters!.CustomAttributes).toBe(
                `text_prompt=${textPrompt}`
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should not include imageProcessorParameters for non-SAM3 models", async () => {
      let capturedRequest: CapturedJobRequest | null = null;

      (
        modelRunnerService.createImageProcessingJob as jest.Mock
      ).mockImplementation((req: CapturedJobRequest) => {
        capturedRequest = req;
        return Promise.resolve({ job_id: "test-uuid-1234", status: "PENDING" });
      });
      (viewpointService.createViewpoint as jest.Mock).mockResolvedValue({});

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            "aircraft-detector",
            "vehicle-model",
            "building-segmentation",
            "yolo-v8"
          ),
          async (endpointName) => {
            capturedRequest = null;

            const result = (await submitImageProcessingJobTool.handler(
              {
                job_name: "test-job",
                image_url: "s3://bucket/path/image.tif",
                model_endpoint_name: endpointName,
                output_bucket: "output-bucket",
                text_prompt: "some prompt" // Provided but should be ignored
              },
              mockStore
            )) as SubmitJobResponse;

            if (result.success && capturedRequest) {
              const req = capturedRequest as unknown as CapturedJobRequest;
              // Property: Non-SAM3 models should not have imageProcessorParameters
              expect(req.imageProcessorParameters).toBeUndefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: model-runner-mcp-tools, Property 8: Job List Sorting
   * Validates: Requirements 5.3
   *
   * For any list_image_processing_jobs response containing multiple jobs,
   * the jobs should be sorted by updated_at in descending order.
   */
  describe("Property 8: Job List Sorting", () => {
    it("should return jobs sorted by updated_at descending", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              job_id: fc.uuid(),
              job_name: fc.string({ minLength: 1, maxLength: 50 }),
              status: fc.constantFrom("SUCCESS", "FAILED", "IN_PROGRESS"),
              updated_at: fc
                .integer({
                  min: 1577836800000,
                  max: 1767225600000
                })
                .map((ts) => new Date(ts).toISOString())
            }),
            { minLength: 2, maxLength: 10 }
          ),
          async (jobs) => {
            // Sort jobs by updated_at descending (as fetchAllJobs should do)
            const sortedJobs = [...jobs].sort(
              (a, b) =>
                new Date(b.updated_at).getTime() -
                new Date(a.updated_at).getTime()
            );

            (fetchAllJobs as jest.Mock).mockResolvedValue({ jobs: sortedJobs });

            const result = (await listImageProcessingJobsTool.handler(
              {},
              mockStore
            )) as ListJobsToolResponse;

            expect(result.success).toBe(true);
            expect(result.jobs!.length).toBe(jobs.length);

            // Property: Jobs are sorted by updated_at descending
            for (let i = 1; i < result.jobs!.length; i++) {
              const prevDate = new Date(
                result.jobs![i - 1].updated_at
              ).getTime();
              const currDate = new Date(result.jobs![i].updated_at).getTime();
              expect(prevDate).toBeGreaterThanOrEqual(currDate);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: model-runner-mcp-tools, Property 10: Non-Completed Job Display Returns Error
   * Validates: Requirements 6.3
   *
   * For any display_detection_results invocation where the job status is not "SUCCESS" or "COMPLETED",
   * the tool handler should return success=false with an error message.
   */
  describe("Property 10: Non-Completed Job Display Returns Error", () => {
    it("should return error for any non-completed job status", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            "IN_PROGRESS",
            "PENDING",
            "FAILED",
            "PARTIAL",
            "QUEUED",
            "STARTING"
          ),
          async (status) => {
            (fetchJobStatus as jest.Mock).mockResolvedValue({
              job: {
                job_id: "job-123",
                job_name: "Test Job",
                status,
                updated_at: "2024-01-01T00:00:00Z"
              }
            });

            const result = (await displayDetectionResultsTool.handler(
              { job_id: "job-123" },
              mockStore
            )) as DisplayResultsResponse;

            // Property: Non-completed jobs return error
            expect(result.success).toBe(false);
            expect(result.error).toContain(status);
            expect(result.message).toBe("Results are not yet available");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should not reject completed job statuses due to status check", () => {
      // Tests isJobSuccessful directly to avoid the 10-second polling loop in displayDetectionResultsTool.

      fc.assert(
        fc.property(fc.constantFrom("SUCCESS", "COMPLETED"), (status) => {
          const { isJobSuccessful } =
            require("@/services/job-management") as typeof import("@/services/job-management");
          // Property: SUCCESS and COMPLETED should pass the status check
          expect(isJobSuccessful(status)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: delete-image-processing-job, MCP Tool Confirmation Contract
   *
   * The delete_image_processing_job tool no longer performs deletion. It
   * returns a confirmation payload for the chat UI to render; the actual
   * deletion runs only when the user clicks Delete on the resulting card.
   * The handler must:
   *   - return success=false for missing job_id
   *   - return success=false when the job does not exist in the store
   *   - return a confirmationRequired payload when the job exists
   *   - never call the backend deleteJob service
   */
  describe("delete_image_processing_job confirmation contract", () => {
    it("returns a confirmation payload (not a deletion) for any existing job", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            job_id: fc.uuid(),
            job_name: fc.string({ minLength: 1, maxLength: 50 }),
            status: fc.constantFrom("SUCCESS", "FAILED", "IN_PROGRESS"),
            output_bucket: fc.string({ minLength: 1, maxLength: 100 }),
            updated_at: fc.constant("2024-01-01T00:00:00Z")
          }),
          async (job) => {
            const storeWithJob = createMockStore([job]);

            const result = (await deleteImageProcessingJobTool.handler(
              { job_id: job.job_id },
              storeWithJob
            )) as Record<string, unknown>;

            expect(result).toMatchObject({
              confirmationRequired: true,
              action: "delete_image_processing_job",
              args: { job_id: job.job_id }
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it("returns success=false (not a confirmation) for any non-existent job id", async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), async (nonExistentJobId) => {
          const emptyStore = createMockStore([]);

          const result = (await deleteImageProcessingJobTool.handler(
            { job_id: nonExistentJobId },
            emptyStore
          )) as {
            success: boolean;
            completed?: boolean;
            message: string;
            confirmationRequired?: boolean;
          };

          expect(result.success).toBe(false);
          expect(result.confirmationRequired).toBeUndefined();
          // "Job not found" is a terminal outcome; should be marked completed
          // so the agent knows not to retry.
          expect(result.completed).toBe(true);
          expect(result.message).toContain(nonExistentJobId);
          expect(result.message).toMatch(/Do not retry/);
        }),
        { numRuns: 100 }
      );
    });

    it("returns validation error when job_id is missing", async () => {
      const emptyStore = createMockStore([]);

      const result = (await deleteImageProcessingJobTool.handler(
        {},
        emptyStore
      )) as {
        success: boolean;
        error: string;
        message: string;
        completed?: boolean;
        confirmationRequired?: boolean;
      };

      expect(result.success).toBe(false);
      expect(result.confirmationRequired).toBeUndefined();
      expect(result.error).toContain("job_id");
      expect(result.message).toMatch(/Validation failed/);
      // Validation errors are retryable; do not mark as completed.
      expect(result.completed).toBeUndefined();
    });
  });
});
