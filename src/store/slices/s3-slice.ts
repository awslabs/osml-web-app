// Copyright Amazon.com, Inc. or its affiliates.
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";

import { s3Service } from "@/services/s3-service.ts";
import { LoadingStatus } from "@/types/loading-status";

export interface S3Bucket {
  name: string;
  creationDate: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: string;
}

export interface S3State {
  buckets: S3Bucket[];
  selectedBucket: string | null;
  bucketObjects: S3Object[];
  bucketsStatus: LoadingStatus;
  bucketsError: string | null;
  objectsStatus: LoadingStatus;
  objectsError: string | null;
}

const initialState: S3State = {
  buckets: [],
  selectedBucket: null,
  bucketObjects: [],
  bucketsStatus: LoadingStatus.Success,
  bucketsError: null,
  objectsStatus: LoadingStatus.Success,
  objectsError: null
};

export const fetchBuckets = createAsyncThunk(
  "s3/fetchBuckets",
  async () => await s3Service.getBuckets()
);

export const fetchBucketContents = createAsyncThunk(
  "s3/fetchBucketContents",
  async (bucketName: string) => await s3Service.getBucketContents(bucketName)
);

const s3Slice = createSlice({
  name: "s3",
  initialState,
  reducers: {
    setSelectedBucket: (state, action: PayloadAction<string | null>) => {
      state.selectedBucket = action.payload;
    }
  },
  extraReducers: (builder) => {
    builder
      // Buckets
      .addCase(fetchBuckets.pending, (state) => {
        state.bucketsStatus = LoadingStatus.Loading;
      })
      .addCase(fetchBuckets.fulfilled, (state, action) => {
        state.bucketsStatus = LoadingStatus.Success;
        state.buckets = action.payload;
      })
      .addCase(fetchBuckets.rejected, (state, action) => {
        state.bucketsStatus = LoadingStatus.Error;
        state.bucketsError = action.error.message || "Failed to fetch buckets";
      })
      // Bucket Contents
      .addCase(fetchBucketContents.pending, (state) => {
        state.objectsStatus = LoadingStatus.Loading;
      })
      .addCase(fetchBucketContents.fulfilled, (state, action) => {
        state.objectsStatus = LoadingStatus.Success;
        state.bucketObjects = action.payload;
      })
      .addCase(fetchBucketContents.rejected, (state, action) => {
        state.objectsStatus = LoadingStatus.Error;
        state.objectsError =
          action.error.message || "Failed to fetch bucket contents";
      });
  }
});

export const { setSelectedBucket } = s3Slice.actions;
export default s3Slice.reducer;
