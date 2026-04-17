// Copyright Amazon.com, Inc. or its affiliates.
import { S3Bucket, S3Object } from "@/store/types.ts";
import { utilityApiClient } from "@/utils/api-client";

export interface GetBucketsResponse {
  buckets: S3Bucket[];
}

export interface GetObjectsResponse {
  bucket: string;
  objects: S3Object[];
}

export interface GetPresignedUrlResponse {
  presignedUrl: string;
}

class S3Service {
  private retryCount: number = 3;

  async getBuckets(): Promise<S3Bucket[]> {
    try {
      const data: GetBucketsResponse =
        await utilityApiClient.get("/s3/buckets");

      return data.buckets;
    } catch {
      throw new Error("Failed to fetch buckets");
    }
  }

  async getBucketContents(bucketName: string): Promise<S3Object[]> {
    try {
      const data: GetObjectsResponse = await utilityApiClient.get(
        `/s3/buckets/${bucketName}/objects`
      );

      return data.objects;
    } catch {
      throw new Error("Failed to fetch bucket contents");
    }
  }

  async getPresignedUrl(
    bucketName: string,
    objectKey: string
  ): Promise<string> {
    try {
      // Don't double-encode the objectKey - it may already be URL-encoded
      const data: GetPresignedUrlResponse = await utilityApiClient.get(
        `/s3/${bucketName}/${objectKey}`
      );

      return data.presignedUrl;
    } catch {
      throw new Error("Failed to get presigned URL");
    }
  }

  async downloadFile(bucketName: string, objectKey: string): Promise<Blob> {
    const presignedUrl = await this.getPresignedUrl(bucketName, objectKey);

    const response = await fetch(presignedUrl, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers: {
        Accept: "*/*"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    return await response.blob();
  }

  async deleteByPrefix(
    bucketName: string,
    prefix: string
  ): Promise<{ deleted: number }> {
    try {
      return await utilityApiClient.delete(
        `/s3/${bucketName}/${encodeURIComponent(prefix)}`
      );
    } catch {
      throw new Error("Failed to delete S3 objects");
    }
  }
}

export const s3Service = new S3Service();
