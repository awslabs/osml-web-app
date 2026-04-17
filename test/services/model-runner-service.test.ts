// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for model-runner-service.ts.
 * Covers job creation, listing, status retrieval, polling with
 * success/failure/timeout, processImageAndWait, and deletion.
 */

import { modelRunnerService } from "@/services/model-runner-service";
import { modelRunnerApiClient } from "@/utils/api-client";

jest.mock("@/utils/api-client", () => ({
  modelRunnerApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn()
  }
}));

const mockGet = modelRunnerApiClient.get as jest.Mock;
const mockPost = modelRunnerApiClient.post as jest.Mock;
const mockDelete = modelRunnerApiClient.delete as jest.Mock;

beforeEach(() => jest.clearAllMocks());

const sampleJobRequest = {
  jobName: "test-job",
  jobId: "job-123",
  imageUrls: ["s3://bucket/image.tif"],
  outputs: [{ type: "S3", bucket: "out-bucket", prefix: "results/" }],
  imageProcessor: { name: "flood", type: "SM_ENDPOINT" },
  imageProcessorTileSize: 512,
  imageProcessorTileOverlap: 64,
  imageProcessorTileFormat: "GTIFF",
  imageProcessorTileCompression: "NONE",
  postProcessing: [],
  rangeAdjustment: "DRA" as const
};

describe("ModelRunnerService", () => {
  describe("createImageProcessingJob", () => {
    it("should POST job request and return job", async () => {
      const mockJob = { job_id: "job-123", status: "PROCESSING" };
      mockPost.mockResolvedValue(mockJob);

      const result =
        await modelRunnerService.createImageProcessingJob(sampleJobRequest);

      expect(mockPost).toHaveBeenCalledWith("/jobs", sampleJobRequest);
      expect(result.job_id).toBe("job-123");
    });

    it("should throw with message on failure", async () => {
      mockPost.mockRejectedValue(new Error("Server error"));
      await expect(
        modelRunnerService.createImageProcessingJob(sampleJobRequest)
      ).rejects.toThrow("Server error");
    });

    it("should throw generic message for non-Error failures", async () => {
      mockPost.mockRejectedValue("unknown");
      await expect(
        modelRunnerService.createImageProcessingJob(sampleJobRequest)
      ).rejects.toThrow("Failed to create image processing job");
    });
  });

  describe("listImageProcessingJobs", () => {
    it("should return jobs array from response", async () => {
      mockGet.mockResolvedValue({
        jobs: [{ job_id: "j1" }, { job_id: "j2" }]
      });

      const jobs = await modelRunnerService.listImageProcessingJobs();
      expect(jobs).toHaveLength(2);
      expect(mockGet).toHaveBeenCalledWith("/jobs");
    });

    it("should throw on failure", async () => {
      mockGet.mockRejectedValue(new Error("Network error"));
      await expect(
        modelRunnerService.listImageProcessingJobs()
      ).rejects.toThrow("Network error");
    });
  });

  describe("getImageProcessingJob", () => {
    it("should fetch job by ID", async () => {
      mockGet.mockResolvedValue({ job_id: "job-123", status: "COMPLETED" });
      const job = await modelRunnerService.getImageProcessingJob("job-123");
      expect(mockGet).toHaveBeenCalledWith("/jobs/job-123");
      expect(job.status).toBe("COMPLETED");
    });
  });

  describe("pollJobStatus", () => {
    it("should return immediately when job is COMPLETED", async () => {
      mockGet.mockResolvedValue({ job_id: "j1", status: "COMPLETED" });

      const job = await modelRunnerService.pollJobStatus("j1", 10, 1000);
      expect(job.status).toBe("COMPLETED");
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it("should return immediately when job is FAILED", async () => {
      mockGet.mockResolvedValue({ job_id: "j1", status: "FAILED" });

      const job = await modelRunnerService.pollJobStatus("j1", 10, 1000);
      expect(job.status).toBe("FAILED");
    });

    it("should poll until completion", async () => {
      mockGet
        .mockResolvedValueOnce({ job_id: "j1", status: "PROCESSING" })
        .mockResolvedValueOnce({ job_id: "j1", status: "PROCESSING" })
        .mockResolvedValueOnce({ job_id: "j1", status: "COMPLETED" });

      const job = await modelRunnerService.pollJobStatus("j1", 10, 5000);
      expect(job.status).toBe("COMPLETED");
      expect(mockGet).toHaveBeenCalledTimes(3);
    });

    it("should throw on timeout", async () => {
      mockGet.mockResolvedValue({ job_id: "j1", status: "PROCESSING" });

      // Very short timeout to trigger quickly
      await expect(
        modelRunnerService.pollJobStatus("j1", 10, 50)
      ).rejects.toThrow("Job polling timed out");
    });
  });

  describe("processImageAndWait", () => {
    it("should create job then poll until done", async () => {
      mockPost.mockResolvedValue({ job_id: "j1", status: "PROCESSING" });
      mockGet.mockResolvedValue({ job_id: "j1", status: "COMPLETED" });

      const job = await modelRunnerService.processImageAndWait(
        sampleJobRequest,
        10,
        1000
      );

      expect(mockPost).toHaveBeenCalledWith("/jobs", sampleJobRequest);
      expect(job.status).toBe("COMPLETED");
    });
  });

  describe("deleteImageProcessingJob", () => {
    it("should return success on successful delete", async () => {
      mockDelete.mockResolvedValue(undefined);
      const result = await modelRunnerService.deleteImageProcessingJob("j1");
      expect(result.success).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith("/jobs/j1");
    });

    it("should return failure with message on error", async () => {
      mockDelete.mockRejectedValue(new Error("Not found"));
      const result = await modelRunnerService.deleteImageProcessingJob("j1");
      expect(result.success).toBe(false);
      expect(result.message).toBe("Not found");
    });

    it("should return generic message for non-Error failures", async () => {
      mockDelete.mockRejectedValue("unknown");
      const result = await modelRunnerService.deleteImageProcessingJob("j1");
      expect(result.success).toBe(false);
      expect(result.message).toBe("Failed to delete image processing job");
    });
  });
});
