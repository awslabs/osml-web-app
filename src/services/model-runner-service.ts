// Copyright Amazon.com, Inc. or its affiliates.
import { modelRunnerApiClient } from "@/utils/api-client";

export interface NMSAlgorithm {
  algorithm_type: "NMS";
  iouThreshold: number;
}

export interface SoftNMSAlgorithm {
  algorithm_type: "SOFT_NMS";
  iouThreshold: number;
  skipBoxThreshold: number;
  sigma: number;
}

export interface FeatureDistillation {
  step: "FEATURE_DISTILLATION";
  algorithm: NMSAlgorithm | SoftNMSAlgorithm;
}

export interface Output {
  type: string;
  bucket?: string;
  prefix?: string;
  stream?: string;
  batchSize?: number;
}

export interface ImageProcessor {
  name: string;
  type: string;
  assumedRole?: string;
}

export interface ImageProcessingJob {
  job_id: string;
  status: string;
  updated_at: string;
  job_name?: string;
  image_status?: string;
  image_id?: string;
  processing_duration?: number;
  output_bucket?: string;
}

export interface CreateJobRequest {
  jobName: string;
  jobId: string;
  imageUrls: string[];
  outputs: Output[];
  imageProcessor: ImageProcessor;
  imageProcessorTileSize: number;
  imageProcessorTileOverlap: number;
  imageProcessorTileFormat: string;
  imageProcessorTileCompression: string;
  imageProcessorParameters?: Record<string, unknown>;
  postProcessing: FeatureDistillation[];
  regionOfInterest?: string;
  rangeAdjustment: "NONE" | "MINMAX" | "DRA";
  imageReadRole?: string;
  featureProperties?: string;
}

export interface ListJobsResponse {
  jobs: ImageProcessingJob[];
}

export interface DeleteJobResponse {
  success: boolean;
  message?: string;
}

class ModelRunnerService {
  private retryCount: number = 3;

  async createImageProcessingJob(
    jobRequest: CreateJobRequest
  ): Promise<ImageProcessingJob> {
    try {
      return await modelRunnerApiClient.post<ImageProcessingJob>(
        "/jobs",
        jobRequest
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create image processing job";
      throw new Error(message);
    }
  }

  async listImageProcessingJobs(): Promise<ImageProcessingJob[]> {
    try {
      const data = await modelRunnerApiClient.get<ListJobsResponse>("/jobs");

      return data.jobs;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to list image processing jobs";
      throw new Error(message);
    }
  }

  async getImageProcessingJob(jobId: string): Promise<ImageProcessingJob> {
    try {
      return await modelRunnerApiClient.get<ImageProcessingJob>(
        `/jobs/${jobId}`
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get image processing job";
      throw new Error(message);
    }
  }

  // Helper method to poll job status
  async pollJobStatus(
    jobId: string,
    intervalMs: number = 5000,
    timeoutMs: number = 300000
  ): Promise<ImageProcessingJob> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const job = await this.getImageProcessingJob(jobId);

      if (job.status === "COMPLETED" || job.status === "FAILED") {
        return job;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error("Job polling timed out");
  }

  // Utility method to create and wait for job completion
  async processImageAndWait(
    jobRequest: CreateJobRequest,
    pollIntervalMs?: number,
    timeoutMs?: number
  ): Promise<ImageProcessingJob> {
    const job = await this.createImageProcessingJob(jobRequest);

    return this.pollJobStatus(job.job_id, pollIntervalMs, timeoutMs);
  }

  async deleteImageProcessingJob(jobId: string): Promise<DeleteJobResponse> {
    try {
      await modelRunnerApiClient.delete(`/jobs/${jobId}`);
      return { success: true, message: `Job ${jobId} deleted successfully` };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to delete image processing job";
      return {
        success: false,
        message
      };
    }
  }
}

export const modelRunnerService = new ModelRunnerService();
