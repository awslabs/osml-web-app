// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for s3-slice.ts async thunks and reducers.
 */

import { configureStore } from "@reduxjs/toolkit";

import s3Reducer, {
  fetchBucketContents,
  fetchBuckets,
  setSelectedBucket
} from "@/store/slices/s3-slice";

jest.mock("@/services/s3-service", () => ({
  s3Service: {
    getBuckets: jest.fn(),
    getBucketContents: jest.fn()
  }
}));

const createStore = () => configureStore({ reducer: { s3: s3Reducer } });

describe("s3-slice", () => {
  describe("setSelectedBucket", () => {
    it("should set selected bucket", () => {
      const store = createStore();
      store.dispatch(setSelectedBucket("my-bucket"));
      expect(store.getState().s3.selectedBucket).toBe("my-bucket");
    });

    it("should allow setting to null", () => {
      const store = createStore();
      store.dispatch(setSelectedBucket("my-bucket"));
      store.dispatch(setSelectedBucket(null));
      expect(store.getState().s3.selectedBucket).toBeNull();
    });
  });

  describe("fetchBuckets", () => {
    it("pending should set loading status", () => {
      const store = createStore();
      store.dispatch(fetchBuckets.pending("r", undefined));
      expect(store.getState().s3.bucketsStatus).toBe("Loading");
    });

    it("fulfilled should set buckets", () => {
      const store = createStore();
      store.dispatch(
        fetchBuckets.fulfilled(
          [{ name: "bucket-1" }, { name: "bucket-2" }] as never,
          "r",
          undefined
        )
      );
      expect(store.getState().s3.buckets).toHaveLength(2);
      expect(store.getState().s3.bucketsStatus).toBe("Success");
    });

    it("rejected should set error", () => {
      const store = createStore();
      store.dispatch(
        fetchBuckets.rejected(new Error("Access denied"), "r", undefined)
      );
      expect(store.getState().s3.bucketsError).toBe("Access denied");
      expect(store.getState().s3.bucketsStatus).toBe("Error");
    });
  });

  describe("fetchBucketContents", () => {
    it("pending should set loading status", () => {
      const store = createStore();
      store.dispatch(fetchBucketContents.pending("r", "bucket-1"));
      expect(store.getState().s3.objectsStatus).toBe("Loading");
    });

    it("fulfilled should set objects", () => {
      const store = createStore();
      store.dispatch(
        fetchBucketContents.fulfilled(
          [{ key: "image.tif", size: 1024 }] as never,
          "r",
          "bucket-1"
        )
      );
      expect(store.getState().s3.bucketObjects).toHaveLength(1);
      expect(store.getState().s3.objectsStatus).toBe("Success");
    });

    it("rejected should set error", () => {
      const store = createStore();
      store.dispatch(
        fetchBucketContents.rejected(new Error("Not found"), "r", "bucket-1")
      );
      expect(store.getState().s3.objectsError).toBe("Not found");
      expect(store.getState().s3.objectsStatus).toBe("Error");
    });
  });
});
