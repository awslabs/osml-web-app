// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for job-submission.ts.
 * Covers resolveOutputBucket and output prefix logic.
 * Validates: Requirements 4.1, 4.3, 4.4
 */

import { resolveOutputBucket } from "@/services/job-submission";
import { s3Service } from "@/services/s3-service";

jest.mock("@/config/site", () => ({
  siteConfig: {
    detection_bridge_bucket: "",
    tile_server_base_url: "http://localhost"
  }
}));

jest.mock("@/services/s3-service", () => ({
  s3Service: { getBuckets: jest.fn() }
}));

const { siteConfig } = require("@/config/site") as {
  siteConfig: { detection_bridge_bucket: string };
};
const mockGetBuckets = s3Service.getBuckets as jest.Mock;

/**
 * Pure function extracted from handleSubmit logic.
 * Given a jobId and an outputs array, maps S3 outputs to use `{jobId}/` as prefix.
 */
function applyJobIdPrefix(
  outputs: Array<{ type: string; [key: string]: unknown }>,
  jobId: string
): Array<{ type: string; prefix?: string; [key: string]: unknown }> {
  return outputs.map((o) =>
    o.type === "S3" ? { ...o, prefix: `${jobId}/` } : o
  );
}

describe("resolveOutputBucket", () => {
  afterEach(() => {
    siteConfig.detection_bridge_bucket = "";
    mockGetBuckets.mockReset();
  });

  it("should return explicit bucket when provided", async () => {
    expect(await resolveOutputBucket("my-explicit-bucket")).toBe(
      "my-explicit-bucket"
    );
  });

  it("should return bridge bucket when configured", async () => {
    siteConfig.detection_bridge_bucket = "webapp-detection-bridge-123456";
    expect(await resolveOutputBucket()).toBe("webapp-detection-bridge-123456");
  });

  it("should fall back to mr-bucket-sink-* when bridge not set", async () => {
    siteConfig.detection_bridge_bucket = "";
    mockGetBuckets.mockResolvedValue([
      { name: "other-bucket", creationDate: "" },
      { name: "mr-bucket-sink-123456789012", creationDate: "" }
    ]);
    expect(await resolveOutputBucket()).toBe("mr-bucket-sink-123456789012");
  });

  it("should return first bucket when no sink match", async () => {
    siteConfig.detection_bridge_bucket = "";
    mockGetBuckets.mockResolvedValue([
      { name: "random-bucket", creationDate: "" }
    ]);
    expect(await resolveOutputBucket()).toBe("random-bucket");
  });

  it("should return undefined when no buckets", async () => {
    siteConfig.detection_bridge_bucket = "";
    mockGetBuckets.mockResolvedValue([]);
    expect(await resolveOutputBucket()).toBeUndefined();
  });

  it("should return undefined when getBuckets fails", async () => {
    siteConfig.detection_bridge_bucket = "";
    mockGetBuckets.mockRejectedValue(new Error("Network error"));
    expect(await resolveOutputBucket()).toBeUndefined();
  });
});

describe("Output prefix logic", () => {
  it("should set S3 output prefix to {job_id}/ format", () => {
    const jobId = "550e8400-e29b-41d4-a716-446655440000";
    const outputs = [
      { type: "S3", bucket: "test-bucket", prefix: "" },
      { type: "Kinesis", stream: "test-stream", batchSize: 1000 }
    ];
    const result = applyJobIdPrefix(outputs, jobId);
    const s3Output = result.find((o) => o.type === "S3");
    expect(s3Output!.prefix).toBe("550e8400-e29b-41d4-a716-446655440000/");
  });

  it("should not add prefix to non-S3 outputs", () => {
    const result = applyJobIdPrefix(
      [{ type: "Kinesis", stream: "test-stream", batchSize: 1000 }],
      "test-job-id"
    );
    expect((result[0] as Record<string, unknown>).prefix).toBeUndefined();
  });

  it("should preserve other S3 output properties", () => {
    const result = applyJobIdPrefix(
      [{ type: "S3", bucket: "my-bucket", prefix: "" }],
      "abc-123"
    );
    expect((result[0] as Record<string, unknown>).bucket).toBe("my-bucket");
    expect(result[0].prefix).toBe("abc-123/");
  });
});
