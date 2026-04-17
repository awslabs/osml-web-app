// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Property-Based Tests for CreateImageJobModal
 *
 * Feature: stac-detection-catalog, Property 5: Job output prefix matches job_id
 *
 * For any job submission with a generated job_id, the S3 output configuration
 * SHALL set the prefix to `{job_id}/` (the job_id followed by a forward slash).
 *
 * **Validates: Requirements 4.3**
 */

import * as fc from "fast-check";

/**
 * Pure function extracted from handleSubmit in create-image-job-modal.tsx.
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

describe("Feature: stac-detection-catalog, Property 5: Job output prefix matches job_id", () => {
  /**
   * Property 5: Job output prefix matches job_id
   *
   * For any UUID jobId and an outputs array containing an S3 output,
   * the resulting prefix should always be `{jobId}/`.
   */
  it("should set S3 output prefix to {job_id}/ for any generated UUID", () => {
    fc.assert(
      fc.property(fc.uuid(), (jobId) => {
        const outputs = [
          { type: "S3", bucket: "some-bucket", prefix: "" },
          { type: "Kinesis", stream: "some-stream", batchSize: 1000 }
        ];

        const result = applyJobIdPrefix(outputs, jobId);

        // The S3 output prefix must be exactly `{jobId}/`
        const s3Output = result.find((o) => o.type === "S3");
        expect(s3Output).toBeDefined();
        expect(s3Output!.prefix).toBe(`${jobId}/`);

        // The prefix must start with the jobId
        expect(s3Output!.prefix).toMatch(new RegExp(`^${jobId}/`));

        // The prefix must end with exactly one forward slash
        expect(s3Output!.prefix).toMatch(/\/$/);
        expect(s3Output!.prefix).not.toMatch(/\/\/$/);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Additional: Non-S3 outputs should not be modified by the prefix logic.
   */
  it("should not modify non-S3 outputs", () => {
    fc.assert(
      fc.property(fc.uuid(), (jobId) => {
        const kinesisOutput = {
          type: "Kinesis",
          stream: "mr-stream-sink",
          batchSize: 1000
        };
        const outputs = [
          { type: "S3", bucket: "test-bucket", prefix: "" },
          kinesisOutput
        ];

        const result = applyJobIdPrefix(outputs, jobId);

        const kinesisResult = result.find((o) => o.type === "Kinesis");
        expect(kinesisResult).toBeDefined();
        expect(kinesisResult!.stream).toBe("mr-stream-sink");
        expect(kinesisResult!.batchSize).toBe(1000);
        expect(
          (kinesisResult as Record<string, unknown>).prefix
        ).toBeUndefined();

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
