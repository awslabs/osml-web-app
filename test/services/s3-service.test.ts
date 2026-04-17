// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for s3-service.ts.
 * Covers bucket listing, object listing, presigned URL generation,
 * file download, and prefix deletion.
 */

import { s3Service } from "@/services/s3-service";
import { utilityApiClient } from "@/utils/api-client";

jest.mock("@/utils/api-client", () => ({
  utilityApiClient: {
    get: jest.fn(),
    delete: jest.fn()
  }
}));

const mockGet = utilityApiClient.get as jest.Mock;
const mockDelete = utilityApiClient.delete as jest.Mock;

// Mock global fetch for downloadFile
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => jest.clearAllMocks());

describe("S3Service", () => {
  describe("getBuckets", () => {
    it("should return buckets array", async () => {
      mockGet.mockResolvedValue({
        buckets: [
          { name: "bucket-1", creationDate: "2024-01-01" },
          { name: "bucket-2", creationDate: "2024-06-01" }
        ]
      });

      const buckets = await s3Service.getBuckets();
      expect(buckets).toHaveLength(2);
      expect(mockGet).toHaveBeenCalledWith("/s3/buckets");
    });

    it("should throw on failure", async () => {
      mockGet.mockRejectedValue(new Error("Network error"));
      await expect(s3Service.getBuckets()).rejects.toThrow(
        "Failed to fetch buckets"
      );
    });
  });

  describe("getBucketContents", () => {
    it("should return objects array for a bucket", async () => {
      mockGet.mockResolvedValue({
        bucket: "my-bucket",
        objects: [{ key: "file.tif", size: 1024, lastModified: "2024-01-01" }]
      });

      const objects = await s3Service.getBucketContents("my-bucket");
      expect(objects).toHaveLength(1);
      expect(mockGet).toHaveBeenCalledWith("/s3/buckets/my-bucket/objects");
    });

    it("should throw on failure", async () => {
      mockGet.mockRejectedValue(new Error("fail"));
      await expect(s3Service.getBucketContents("bucket")).rejects.toThrow(
        "Failed to fetch bucket contents"
      );
    });
  });

  describe("getPresignedUrl", () => {
    it("should return presigned URL string", async () => {
      mockGet.mockResolvedValue({
        presignedUrl: "https://s3.amazonaws.com/bucket/key?signature=abc"
      });

      const url = await s3Service.getPresignedUrl("bucket", "path/to/file.tif");
      expect(url).toContain("signature=abc");
      expect(mockGet).toHaveBeenCalledWith("/s3/bucket/path/to/file.tif");
    });

    it("should throw on failure", async () => {
      mockGet.mockRejectedValue(new Error("fail"));
      await expect(s3Service.getPresignedUrl("b", "k")).rejects.toThrow(
        "Failed to get presigned URL"
      );
    });
  });

  describe("downloadFile", () => {
    it("should fetch presigned URL and return blob", async () => {
      mockGet.mockResolvedValue({
        presignedUrl: "https://s3.example.com/file?sig=abc"
      });

      const mockBlob = new Blob(["data"], { type: "image/tiff" });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob)
      });

      const blob = await s3Service.downloadFile("bucket", "file.tif");
      expect(blob).toBe(mockBlob);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://s3.example.com/file?sig=abc",
        expect.objectContaining({ method: "GET", credentials: "omit" })
      );
    });

    it("should throw when download response is not ok", async () => {
      mockGet.mockResolvedValue({
        presignedUrl: "https://s3.example.com/file"
      });
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Forbidden"
      });

      await expect(s3Service.downloadFile("b", "k")).rejects.toThrow(
        "Failed to download file: Forbidden"
      );
    });
  });

  describe("deleteByPrefix", () => {
    it("should call DELETE with encoded prefix", async () => {
      mockDelete.mockResolvedValue({ deleted: 5 });

      const result = await s3Service.deleteByPrefix("bucket", "results/job-1/");
      expect(result.deleted).toBe(5);
      expect(mockDelete).toHaveBeenCalledWith(
        `/s3/bucket/${encodeURIComponent("results/job-1/")}`
      );
    });

    it("should throw on failure", async () => {
      mockDelete.mockRejectedValue(new Error("fail"));
      await expect(s3Service.deleteByPrefix("b", "p")).rejects.toThrow(
        "Failed to delete S3 objects"
      );
    });
  });
});
