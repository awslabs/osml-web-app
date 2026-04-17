// Copyright Amazon.com, Inc. or its affiliates.
import {
  fetchAllJobs,
  fetchJobStatus,
  isJobComplete,
  isJobSuccessful
} from "@/services/job-management";
import {
  ImageProcessingJob,
  modelRunnerService
} from "@/services/model-runner-service";

// Mock the model-runner-service
jest.mock("@/services/model-runner-service", () => ({
  modelRunnerService: {
    listImageProcessingJobs: jest.fn(),
    getImageProcessingJob: jest.fn()
  }
}));

describe("job-management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("fetchAllJobs", () => {
    it("should return sorted jobs by updated_at descending", async () => {
      const mockJobs: ImageProcessingJob[] = [
        {
          job_id: "job-1",
          status: "SUCCESS",
          updated_at: "2024-01-01T10:00:00Z"
        },
        {
          job_id: "job-2",
          status: "IN_PROGRESS",
          updated_at: "2024-01-02T10:00:00Z"
        },
        {
          job_id: "job-3",
          status: "FAILED",
          updated_at: "2024-01-01T15:00:00Z"
        }
      ];

      (
        modelRunnerService.listImageProcessingJobs as jest.Mock
      ).mockResolvedValue(mockJobs);

      const result = await fetchAllJobs();

      expect(result.error).toBeUndefined();
      expect(result.jobs).toHaveLength(3);
      // Should be sorted by updated_at descending (most recent first)
      expect(result.jobs[0].job_id).toBe("job-2");
      expect(result.jobs[1].job_id).toBe("job-3");
      expect(result.jobs[2].job_id).toBe("job-1");
    });

    it("should return empty array when no jobs exist", async () => {
      (
        modelRunnerService.listImageProcessingJobs as jest.Mock
      ).mockResolvedValue([]);

      const result = await fetchAllJobs();

      expect(result.error).toBeUndefined();
      expect(result.jobs).toEqual([]);
    });

    it("should return error when service fails", async () => {
      (
        modelRunnerService.listImageProcessingJobs as jest.Mock
      ).mockRejectedValue(new Error("Service unavailable"));

      const result = await fetchAllJobs();

      expect(result.jobs).toEqual([]);
      expect(result.error).toBe("Service unavailable");
    });
  });

  describe("fetchJobStatus", () => {
    it("should return job data for valid job_id", async () => {
      const mockJob: ImageProcessingJob = {
        job_id: "job-123",
        status: "SUCCESS",
        updated_at: "2024-01-01T10:00:00Z",
        job_name: "Test Job",
        processing_duration: 120
      };

      (modelRunnerService.getImageProcessingJob as jest.Mock).mockResolvedValue(
        mockJob
      );

      const result = await fetchJobStatus("job-123");

      expect(result.error).toBeUndefined();
      expect(result.job).toEqual(mockJob);
      expect(modelRunnerService.getImageProcessingJob).toHaveBeenCalledWith(
        "job-123"
      );
    });

    it("should return error when job not found", async () => {
      (modelRunnerService.getImageProcessingJob as jest.Mock).mockRejectedValue(
        new Error("Job not found")
      );

      const result = await fetchJobStatus("invalid-job");

      expect(result.job).toBeNull();
      expect(result.error).toBe("Job not found");
    });
  });

  describe("isJobComplete", () => {
    it("should return true for SUCCESS status", () => {
      expect(isJobComplete("SUCCESS")).toBe(true);
    });

    it("should return true for PARTIAL status", () => {
      expect(isJobComplete("PARTIAL")).toBe(true);
    });

    it("should return true for FAILED status", () => {
      expect(isJobComplete("FAILED")).toBe(true);
    });

    it("should return false for IN_PROGRESS status", () => {
      expect(isJobComplete("IN_PROGRESS")).toBe(false);
    });

    it("should return false for PENDING status", () => {
      expect(isJobComplete("PENDING")).toBe(false);
    });
  });

  describe("isJobSuccessful", () => {
    it("should return true for SUCCESS status", () => {
      expect(isJobSuccessful("SUCCESS")).toBe(true);
    });

    it("should return true for COMPLETED status", () => {
      expect(isJobSuccessful("COMPLETED")).toBe(true);
    });

    it("should return false for PARTIAL status", () => {
      expect(isJobSuccessful("PARTIAL")).toBe(false);
    });

    it("should return false for FAILED status", () => {
      expect(isJobSuccessful("FAILED")).toBe(false);
    });

    it("should return false for IN_PROGRESS status", () => {
      expect(isJobSuccessful("IN_PROGRESS")).toBe(false);
    });
  });
});
