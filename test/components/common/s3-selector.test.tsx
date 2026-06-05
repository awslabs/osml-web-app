// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for S3Selector component.
 * Covers bucket/object select rendering.
 */

import { screen } from "@testing-library/react";

import { S3Selector } from "@/components/common/s3-selector";
import { fetchBuckets } from "@/store/slices/s3-slice";

// Mock s3Service to return resolved values (prevents useEffect crash)
jest.mock("@/services/s3-service", () => ({
  s3Service: {
    getBuckets: jest.fn().mockResolvedValue([]),
    getBucketContents: jest.fn().mockResolvedValue([])
  }
}));

import { createTestStore, renderWithStore } from "../../test-utils";

describe("S3Selector", () => {
  it("should render bucket and object selects", () => {
    const store = createTestStore();
    // Pre-populate with empty buckets so .map() doesn't crash
    store.dispatch(fetchBuckets.fulfilled([], "r", undefined));

    renderWithStore(
      <S3Selector
        onBucketChange={jest.fn()}
        onObjectChange={jest.fn()}
        selectedBucket=""
        selectedObject=""
      />,
      { store }
    );
    // HeroUI Select renders label in both a hidden select and the visible trigger
    expect(screen.getAllByText("S3 Bucket").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("S3 Object").length).toBeGreaterThanOrEqual(1);
  });

  it("should render bucket options when buckets loaded", () => {
    const store = createTestStore();
    store.dispatch(
      fetchBuckets.fulfilled(
        [{ name: "my-bucket", creationDate: "2024-01-01" }],
        "r",
        undefined
      )
    );

    renderWithStore(
      <S3Selector
        onBucketChange={jest.fn()}
        onObjectChange={jest.fn()}
        selectedBucket=""
        selectedObject=""
      />,
      { store }
    );
    expect(screen.getByText("my-bucket")).toBeInTheDocument();
  });
});
