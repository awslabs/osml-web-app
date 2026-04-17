// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for Model Runner MCP Tools
 *
 * Tests cover:
 * - Empty list responses (Requirements 1.3, 5.4)
 * - Service failure error handling (Requirements 1.4, 2.4, 3.8, 4.6, 5.5, 6.6)
 * - Validation error handling (Requirements 3.7)
 * - Job not found errors (Requirements 4.5, 6.7)
 * - Failed job status with error information (Requirement 4.4)
 */

import { configureStore } from "@reduxjs/toolkit";

import {
  displayDetectionResultsTool,
  DisplayResultsResponse,
  GetJobStatusResponse,
  getJobStatusTool,
  ListAvailableImagesResponse,
  listAvailableImagesTool,
  listImageProcessingJobsTool,
  ListJobsResponse,
  ListModelEndpointsResponse,
  listModelEndpointsTool,
  submitImageProcessingJobTool,
  SubmitJobResponse
} from "@/mcp/local-server/model-runner-tools";

// Mock services
jest.mock("@/services/sagemaker-service", () => ({
  sagemakerService: {
    getEndpoints: jest.fn()
  }
}));

jest.mock("@/services/s3-service", () => ({
  s3Service: {
    getBuckets: jest.fn(),
    getBucketContents: jest.fn()
  }
}));

jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: {
    getViewpoints: jest.fn(),
    createViewpoint: jest.fn()
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
const createMockStore = () => {
  return configureStore({
    reducer: {
      mapViewer: (
        state = {
          map: { viewpointData: {}, geoJSONData: {}, layerStyles: {} },
          jobsList: {
            jobs: [],
            customOrder: [],
            isLoading: false,
            isRefreshing: false,
            error: null
          }
        }
      ) => state,
      viewport: (state = {}) => state
    }
  });
};

describe("Model Runner MCP Tools - Unit Tests", () => {
  let mockStore: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = createMockStore();
  });

  describe("listModelEndpointsTool", () => {
    /**
     * Validates: Requirement 1.3 - Empty list with informative message
     */
    it("should return empty list with informative message when no endpoints exist", async () => {
      (sagemakerService.getEndpoints as jest.Mock).mockResolvedValue([]);

      const result = (await listModelEndpointsTool.handler(
        {},
        mockStore
      )) as ListModelEndpointsResponse;

      expect(result).toEqual({
        success: true,
        endpoints: [],
        message:
          "No SageMaker endpoints found. Please ensure ML models are deployed."
      });
    });

    /**
     * Validates: Requirement 1.4 - Service failure error handling
     */
    it("should return error when SageMaker service fails", async () => {
      (sagemakerService.getEndpoints as jest.Mock).mockRejectedValue(
        new Error("Service unavailable")
      );

      const result = (await listModelEndpointsTool.handler(
        {},
        mockStore
      )) as ListModelEndpointsResponse;

      expect(result).toEqual({
        success: false,
        error: "Service unavailable",
        message: "Failed to list SageMaker endpoints"
      });
    });

    it("should return endpoints with availability status", async () => {
      (sagemakerService.getEndpoints as jest.Mock).mockResolvedValue([
        { name: "endpoint-1", status: "InService", creationTime: null },
        { name: "endpoint-2", status: "Creating", creationTime: null }
      ]);

      const result = (await listModelEndpointsTool.handler(
        {},
        mockStore
      )) as ListModelEndpointsResponse;

      expect(result).toEqual({
        success: true,
        endpoints: [
          { name: "endpoint-1", status: "InService", available: true },
          { name: "endpoint-2", status: "Creating", available: false }
        ],
        message: "Found 2 SageMaker endpoint(s)"
      });
    });
  });

  describe("listAvailableImagesTool", () => {
    /**
     * Validates: Requirement 2.4 - S3 service failure error handling
     */
    it("should return error when S3 service fails to list buckets", async () => {
      (s3Service.getBuckets as jest.Mock).mockRejectedValue(
        new Error("S3 service connection failed")
      );

      const result = (await listAvailableImagesTool.handler(
        {},
        mockStore
      )) as ListAvailableImagesResponse;

      expect(result).toEqual({
        success: false,
        total_buckets: 0,
        total_objects: 0,
        error: "S3 service connection failed",
        message: "Failed to list available images from S3"
      });
    });

    it("should return empty list when no buckets exist", async () => {
      (s3Service.getBuckets as jest.Mock).mockResolvedValue([]);

      const result = (await listAvailableImagesTool.handler(
        {},
        mockStore
      )) as ListAvailableImagesResponse;

      expect(result).toEqual({
        success: true,
        buckets: [],
        total_buckets: 0,
        total_objects: 0,
        message: "No S3 buckets found."
      });
    });

    it("should return objects from a specific bucket when bucket_name is provided", async () => {
      (s3Service.getBucketContents as jest.Mock).mockResolvedValue([
        { key: "image1.tif", size: 1024, lastModified: "2024-01-01T10:00:00Z" },
        { key: "image2.tif", size: 2048, lastModified: "2024-01-02T10:00:00Z" }
      ]);

      const result = (await listAvailableImagesTool.handler(
        { bucket_name: "test-bucket" },
        mockStore
      )) as ListAvailableImagesResponse;

      expect(result).toEqual({
        success: true,
        buckets: [
          {
            bucket_name: "test-bucket",
            object_count: 2,
            objects: [
              {
                key: "image1.tif",
                size: 1024,
                last_modified: "2024-01-01T10:00:00Z"
              },
              {
                key: "image2.tif",
                size: 2048,
                last_modified: "2024-01-02T10:00:00Z"
              }
            ],
            truncated: false
          }
        ],
        total_buckets: 1,
        total_objects: 2,
        message: "Found 2 object(s) in bucket 'test-bucket'."
      });
    });

    it("should truncate objects when exceeding max_objects_per_bucket", async () => {
      const manyObjects = Array.from({ length: 100 }, (_, i) => ({
        key: `image${i}.tif`,
        size: 1024,
        lastModified: "2024-01-01T10:00:00Z"
      }));
      (s3Service.getBucketContents as jest.Mock).mockResolvedValue(manyObjects);

      const result = (await listAvailableImagesTool.handler(
        { bucket_name: "test-bucket", max_objects_per_bucket: 10 },
        mockStore
      )) as ListAvailableImagesResponse;

      expect(result.success).toBe(true);
      expect(result.buckets?.[0].objects.length).toBe(10);
      expect(result.buckets?.[0].truncated).toBe(true);
      expect(result.buckets?.[0].object_count).toBe(100);
      expect(result.message).toContain("Showing first 10");
    });

    it("should list objects from all buckets when no bucket_name is provided", async () => {
      (s3Service.getBuckets as jest.Mock).mockResolvedValue([
        { name: "bucket-1", creationDate: "2024-01-01T00:00:00Z" },
        { name: "bucket-2", creationDate: "2024-01-02T00:00:00Z" }
      ]);
      (s3Service.getBucketContents as jest.Mock)
        .mockResolvedValueOnce([
          {
            key: "image1.tif",
            size: 1024,
            lastModified: "2024-01-01T10:00:00Z"
          }
        ])
        .mockResolvedValueOnce([
          {
            key: "image2.tif",
            size: 2048,
            lastModified: "2024-01-02T10:00:00Z"
          },
          {
            key: "image3.tif",
            size: 3072,
            lastModified: "2024-01-03T10:00:00Z"
          }
        ]);

      const result = (await listAvailableImagesTool.handler(
        {},
        mockStore
      )) as ListAvailableImagesResponse;

      expect(result.success).toBe(true);
      expect(result.total_buckets).toBe(2);
      expect(result.total_objects).toBe(3);
      expect(result.buckets?.length).toBe(2);
    });

    it("should handle bucket access errors gracefully", async () => {
      (s3Service.getBuckets as jest.Mock).mockResolvedValue([
        { name: "accessible-bucket", creationDate: "2024-01-01T00:00:00Z" },
        { name: "inaccessible-bucket", creationDate: "2024-01-02T00:00:00Z" }
      ]);
      (s3Service.getBucketContents as jest.Mock)
        .mockResolvedValueOnce([
          {
            key: "image1.tif",
            size: 1024,
            lastModified: "2024-01-01T10:00:00Z"
          }
        ])
        .mockRejectedValueOnce(new Error("Access denied"));

      const result = (await listAvailableImagesTool.handler(
        {},
        mockStore
      )) as ListAvailableImagesResponse;

      expect(result.success).toBe(true);
      expect(result.total_buckets).toBe(1);
      expect(result.buckets?.length).toBe(1);
      expect(result.buckets?.[0].bucket_name).toBe("accessible-bucket");
    });

    it("should cap max_objects_per_bucket at 100", async () => {
      const manyObjects = Array.from({ length: 200 }, (_, i) => ({
        key: `image${i}.tif`,
        size: 1024,
        lastModified: "2024-01-01T10:00:00Z"
      }));
      (s3Service.getBucketContents as jest.Mock).mockResolvedValue(manyObjects);

      const result = (await listAvailableImagesTool.handler(
        { bucket_name: "test-bucket", max_objects_per_bucket: 500 },
        mockStore
      )) as ListAvailableImagesResponse;

      expect(result.success).toBe(true);
      expect(result.buckets?.[0].objects.length).toBe(100);
      expect(result.buckets?.[0].truncated).toBe(true);
    });
  });

  describe("submitImageProcessingJobTool", () => {
    /**
     * Validates: Requirement 3.7 - Missing required parameters validation
     */
    it("should return validation error when required parameters are missing", async () => {
      const result = (await submitImageProcessingJobTool.handler(
        {},
        mockStore
      )) as SubmitJobResponse;

      expect(result).toMatchObject({
        success: false,
        error:
          "Missing required parameters: jobName, imageUrl, modelEndpointName"
      });
    });

    it("should return validation error for partial missing parameters", async () => {
      const result = (await submitImageProcessingJobTool.handler(
        { job_name: "test-job" },
        mockStore
      )) as SubmitJobResponse;

      expect(result).toMatchObject({
        success: false,
        error: "Missing required parameters: imageUrl, modelEndpointName"
      });
    });

    it("should return validation error for invalid S3 URI format", async () => {
      const result = (await submitImageProcessingJobTool.handler(
        {
          job_name: "test-job",
          image_url: "invalid-url",
          model_endpoint_name: "endpoint-1",
          output_bucket: "output-bucket"
        },
        mockStore
      )) as SubmitJobResponse;

      expect(result).toMatchObject({
        success: false,
        error: "Invalid imageUrl format. Expected s3://bucket/path/to/image"
      });
    });

    /**
     * Validates: Requirement 3.8 - Model Runner service failure
     */
    it("should return error when Model Runner service fails", async () => {
      (
        modelRunnerService.createImageProcessingJob as jest.Mock
      ).mockRejectedValue(new Error("Model Runner service unavailable"));
      (viewpointService.createViewpoint as jest.Mock).mockResolvedValue({});

      const result = (await submitImageProcessingJobTool.handler(
        {
          job_name: "test-job",
          image_url: "s3://bucket/path/image.tif",
          model_endpoint_name: "endpoint-1",
          output_bucket: "output-bucket"
        },
        mockStore
      )) as SubmitJobResponse;

      expect(result).toMatchObject({
        success: false,
        error: "Model Runner service unavailable"
      });
    });

    it("should successfully create job with explicit output_bucket", async () => {
      (
        modelRunnerService.createImageProcessingJob as jest.Mock
      ).mockResolvedValue({
        job_id: "test-uuid-1234",
        status: "PENDING"
      });
      (viewpointService.createViewpoint as jest.Mock).mockResolvedValue({});

      const result = (await submitImageProcessingJobTool.handler(
        {
          job_name: "test-job",
          image_url: "s3://bucket/path/image.tif",
          model_endpoint_name: "endpoint-1",
          output_bucket: "custom-output-bucket"
        },
        mockStore
      )) as SubmitJobResponse;

      expect(result).toEqual({
        success: true,
        job_id: "test-uuid-1234",
        job_name: "test-job",
        status: "PENDING",
        message: "Image processing job 'test-job' submitted successfully"
      });

      // Verify the custom bucket was used
      expect(modelRunnerService.createImageProcessingJob).toHaveBeenCalledWith(
        expect.objectContaining({
          outputs: expect.arrayContaining([
            expect.objectContaining({ bucket: "custom-output-bucket" })
          ]) as unknown
        })
      );
    });

    it("should default to sink bucket when output_bucket not provided", async () => {
      (s3Service.getBuckets as jest.Mock).mockResolvedValue([
        { name: "mr-bucket-sink-123456", creationDate: "2024-01-01T00:00:00Z" }
      ]);
      (
        modelRunnerService.createImageProcessingJob as jest.Mock
      ).mockResolvedValue({
        job_id: "test-uuid-1234",
        status: "PENDING"
      });
      (viewpointService.createViewpoint as jest.Mock).mockResolvedValue({});

      const result = (await submitImageProcessingJobTool.handler(
        {
          job_name: "test-job",
          image_url: "s3://bucket/path/image.tif",
          model_endpoint_name: "endpoint-1",
          output_bucket: ""
        },
        mockStore
      )) as SubmitJobResponse;

      expect(result).toEqual({
        success: true,
        job_id: "test-uuid-1234",
        job_name: "test-job",
        status: "PENDING",
        message: "Image processing job 'test-job' submitted successfully"
      });

      // Verify the sink bucket was used
      expect(modelRunnerService.createImageProcessingJob).toHaveBeenCalledWith(
        expect.objectContaining({
          outputs: expect.arrayContaining([
            expect.objectContaining({ bucket: "mr-bucket-sink-123456" })
          ]) as unknown
        })
      );
    });

    it("should return error when no buckets available and output_bucket empty", async () => {
      (s3Service.getBuckets as jest.Mock).mockResolvedValue([]);

      const result = (await submitImageProcessingJobTool.handler(
        {
          job_name: "test-job",
          image_url: "s3://bucket/path/image.tif",
          model_endpoint_name: "endpoint-1",
          output_bucket: ""
        },
        mockStore
      )) as SubmitJobResponse;

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining("output bucket") as unknown
      });
    });

    it("should fall back to first available bucket when no sink bucket exists", async () => {
      (s3Service.getBuckets as jest.Mock).mockResolvedValue([
        { name: "some-other-bucket", creationDate: "2024-01-01T00:00:00Z" }
      ]);
      (
        modelRunnerService.createImageProcessingJob as jest.Mock
      ).mockResolvedValue({
        job_id: "test-uuid-1234",
        status: "PENDING"
      });
      (viewpointService.createViewpoint as jest.Mock).mockResolvedValue({});

      const result = (await submitImageProcessingJobTool.handler(
        {
          job_name: "test-job",
          image_url: "s3://bucket/path/image.tif",
          model_endpoint_name: "endpoint-1",
          output_bucket: ""
        },
        mockStore
      )) as SubmitJobResponse;

      expect(result.success).toBe(true);
      expect(modelRunnerService.createImageProcessingJob).toHaveBeenCalledWith(
        expect.objectContaining({
          outputs: expect.arrayContaining([
            expect.objectContaining({ bucket: "some-other-bucket" })
          ]) as unknown
        })
      );
    });
  });

  describe("getJobStatusTool", () => {
    /**
     * Validates: Requirement 4.5 - Job not found error
     */
    it("should return error when job is not found", async () => {
      (fetchJobStatus as jest.Mock).mockResolvedValue({
        job: null,
        error: "Job not found"
      });

      const result = (await getJobStatusTool.handler(
        { job_id: "non-existent-job" },
        mockStore
      )) as GetJobStatusResponse;

      expect(result).toEqual({
        success: false,
        error: "Job not found",
        message: "The specified job does not exist"
      });
    });

    /**
     * Validates: Requirement 4.6 - Model Runner service failure
     */
    it("should return error when service fails", async () => {
      (fetchJobStatus as jest.Mock).mockRejectedValue(
        new Error("Service unavailable")
      );

      const result = (await getJobStatusTool.handler(
        { job_id: "job-123" },
        mockStore
      )) as GetJobStatusResponse;

      expect(result).toEqual({
        success: false,
        error: "Service unavailable",
        message: "Failed to get job status"
      });
    });

    /**
     * Validates: Requirement 4.4 - Failed job status with error information
     */
    it("should return job status for failed job", async () => {
      (fetchJobStatus as jest.Mock).mockResolvedValue({
        job: {
          job_id: "job-123",
          job_name: "Failed Job",
          status: "FAILED",
          image_status: "ERROR",
          processing_duration: 60,
          output_bucket: "output-bucket"
        }
      });

      const result = (await getJobStatusTool.handler(
        { job_id: "job-123" },
        mockStore
      )) as GetJobStatusResponse;

      expect(result).toEqual({
        success: true,
        job: {
          job_id: "job-123",
          job_name: "Failed Job",
          status: "FAILED",
          image_status: "ERROR",
          processing_duration: 60,
          output_bucket: "output-bucket",
          results_ready: false
        },
        message: "Job 'Failed Job' status: FAILED"
      });
    });

    it("should return job status with results_ready for completed job", async () => {
      (fetchJobStatus as jest.Mock).mockResolvedValue({
        job: {
          job_id: "job-123",
          job_name: "Completed Job",
          status: "SUCCESS",
          image_status: "COMPLETED",
          processing_duration: 120,
          output_bucket: "output-bucket"
        }
      });

      const result = (await getJobStatusTool.handler(
        { job_id: "job-123" },
        mockStore
      )) as GetJobStatusResponse;

      expect(result).toEqual({
        success: true,
        job: {
          job_id: "job-123",
          job_name: "Completed Job",
          status: "SUCCESS",
          image_status: "COMPLETED",
          processing_duration: 120,
          output_bucket: "output-bucket",
          results_ready: true
        },
        message: "Job 'Completed Job' completed. Results are ready for display."
      });
    });

    it("should return validation error when job_id is missing", async () => {
      const result = (await getJobStatusTool.handler(
        {},
        mockStore
      )) as GetJobStatusResponse;

      expect(result).toEqual({
        success: false,
        error: "Missing required parameter: job_id",
        message: "Validation failed"
      });
    });
  });

  describe("listImageProcessingJobsTool", () => {
    /**
     * Validates: Requirement 5.4 - Empty list with informative message
     */
    it("should return empty list with informative message when no jobs exist", async () => {
      (fetchAllJobs as jest.Mock).mockResolvedValue({ jobs: [] });

      const result = (await listImageProcessingJobsTool.handler(
        {},
        mockStore
      )) as ListJobsResponse;

      expect(result).toEqual({
        success: true,
        jobs: [],
        total_count: 0,
        message: "No image processing jobs found. Submit a job to get started."
      });
    });

    /**
     * Validates: Requirement 5.5 - Model Runner service failure
     */
    it("should return error when service fails", async () => {
      (fetchAllJobs as jest.Mock).mockResolvedValue({
        jobs: [],
        error: "Service unavailable"
      });

      const result = (await listImageProcessingJobsTool.handler(
        {},
        mockStore
      )) as ListJobsResponse;

      expect(result).toEqual({
        success: false,
        error: "Service unavailable",
        total_count: 0,
        message: "Failed to list image processing jobs"
      });
    });

    it("should return jobs list with correct structure", async () => {
      (fetchAllJobs as jest.Mock).mockResolvedValue({
        jobs: [
          {
            job_id: "job-1",
            job_name: "Job 1",
            status: "SUCCESS",
            image_status: "COMPLETED",
            updated_at: "2024-01-02T10:00:00Z"
          },
          {
            job_id: "job-2",
            job_name: "Job 2",
            status: "IN_PROGRESS",
            image_status: "PROCESSING",
            updated_at: "2024-01-01T10:00:00Z"
          }
        ]
      });

      const result = (await listImageProcessingJobsTool.handler(
        {},
        mockStore
      )) as ListJobsResponse;

      expect(result).toEqual({
        success: true,
        jobs: [
          {
            job_id: "job-1",
            job_name: "Job 1",
            status: "SUCCESS",
            image_status: "COMPLETED",
            updated_at: "2024-01-02T10:00:00Z"
          },
          {
            job_id: "job-2",
            job_name: "Job 2",
            status: "IN_PROGRESS",
            image_status: "PROCESSING",
            updated_at: "2024-01-01T10:00:00Z"
          }
        ],
        total_count: 2,
        message: "Found 2 image processing job(s)"
      });
    });
  });

  describe("displayDetectionResultsTool", () => {
    /**
     * Validates: Requirement 6.7 - Job not found error
     */
    it("should return error when job is not found", async () => {
      (fetchJobStatus as jest.Mock).mockResolvedValue({
        job: null,
        error: "Job not found: non-existent-job"
      });

      const result = (await displayDetectionResultsTool.handler(
        { job_id: "non-existent-job" },
        mockStore
      )) as DisplayResultsResponse;

      expect(result).toEqual({
        success: false,
        error: "Job not found: non-existent-job",
        message: "The specified job does not exist"
      });
    });

    /**
     * Validates: Requirement 6.6 - GeoJSON fetch failure
     */
    it("should return error when service fails", async () => {
      (fetchJobStatus as jest.Mock).mockRejectedValue(
        new Error("Failed to fetch job")
      );

      const result = (await displayDetectionResultsTool.handler(
        { job_id: "job-123" },
        mockStore
      )) as DisplayResultsResponse;

      expect(result).toEqual({
        success: false,
        error: "Failed to fetch job",
        message: "Failed to display detection results"
      });
    });

    it("should return error when job is not completed", async () => {
      (fetchJobStatus as jest.Mock).mockResolvedValue({
        job: {
          job_id: "job-123",
          job_name: "In Progress Job",
          status: "IN_PROGRESS"
        }
      });

      const result = (await displayDetectionResultsTool.handler(
        { job_id: "job-123" },
        mockStore
      )) as DisplayResultsResponse;

      expect(result).toEqual({
        success: false,
        error:
          "Job status is 'IN_PROGRESS'. Results are only available for completed jobs.",
        message: "Results are not yet available"
      });
    });

    it("should return validation error when job_id is missing", async () => {
      const result = (await displayDetectionResultsTool.handler(
        {},
        mockStore
      )) as DisplayResultsResponse;

      expect(result).toEqual({
        success: false,
        error: "Missing required parameter: job_id",
        message: "Validation failed"
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: deleteImageProcessingJobTool
// ---------------------------------------------------------------------------

import {
  deleteImageProcessingJobTool,
  DeleteJobToolResponse
} from "@/mcp/local-server/model-runner-tools";
import { deleteJob } from "@/services/job-management";

describe("deleteImageProcessingJobTool", () => {
  it("should return validation error when job_id is missing", async () => {
    const result = (await deleteImageProcessingJobTool.handler(
      {},
      createMockStore()
    )) as DeleteJobToolResponse;

    expect(result).toEqual({
      success: false,
      error: "Missing required parameter: job_id",
      message: "Validation failed"
    });
  });

  it("should return error when job not found in store", async () => {
    // Create store with jobs slice that has an empty jobs array
    const storeWithJobs = configureStore({
      reducer: {
        mapViewer: (
          state = {
            map: { viewpointData: {}, geoJSONData: {}, layerStyles: {} },
            jobsList: {
              jobs: [],
              customOrder: [],
              isLoading: false,
              isRefreshing: false,
              error: null
            }
          }
        ) => state,
        viewport: (state = {}) => state,
        jobs: (
          state = {
            jobsList: {
              jobs: [],
              customOrder: [],
              isLoading: false,
              isRefreshing: false,
              error: null
            },
            selection: { selectedJobs: [], layerStyles: {} }
          }
        ) => state,
        overlay: (state = { layers: {} }) => state,
        imagery: (state = { viewpointData: {} }) => state
      }
    });

    const result = (await deleteImageProcessingJobTool.handler(
      { job_id: "non-existent" },
      storeWithJobs
    )) as DeleteJobToolResponse;

    expect(result.success).toBe(false);
    expect(result.error).toContain("Job not found");
  });

  it("should handle service error during deletion", async () => {
    const storeWithJob = configureStore({
      reducer: {
        mapViewer: (
          state = {
            map: { viewpointData: {}, geoJSONData: {}, layerStyles: {} },
            jobsList: {
              jobs: [],
              customOrder: [],
              isLoading: false,
              isRefreshing: false,
              error: null
            }
          }
        ) => state,
        viewport: (state = {}) => state,
        jobs: (
          state = {
            jobsList: {
              jobs: [
                {
                  job_id: "job-1",
                  job_name: "Test Job",
                  status: "SUCCESS",
                  output_bucket: "bucket"
                }
              ],
              customOrder: ["job-1"],
              isLoading: false,
              isRefreshing: false,
              error: null
            },
            selection: { selectedJobs: [], layerStyles: {} }
          }
        ) => state,
        overlay: (state = { layers: {} }) => state,
        imagery: (state = { viewpointData: {} }) => state
      }
    });

    (deleteJob as jest.Mock).mockRejectedValue(
      new Error("Delete service failed")
    );

    const result = (await deleteImageProcessingJobTool.handler(
      { job_id: "job-1" },
      storeWithJob
    )) as DeleteJobToolResponse;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Delete service failed");
  });
});
