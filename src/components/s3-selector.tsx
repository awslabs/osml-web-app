// Copyright Amazon.com, Inc. or its affiliates.
import { Select, SelectItem } from "@heroui/select";
import { ChangeEvent, useEffect } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks.ts";
import {
  fetchBucketContents,
  fetchBuckets,
  setSelectedBucket
} from "@/store/slices/s3-slice.ts";
import { LoadingStatus } from "@/store/types.ts";

interface S3SelectorProps {
  onBucketChange: (value: string) => void;
  onObjectChange: (value: string) => void;
  selectedBucket: string;
  selectedObject: string;
}

export function S3Selector({
  onBucketChange,
  onObjectChange,
  selectedBucket,
  selectedObject
}: S3SelectorProps) {
  const dispatch = useAppDispatch();
  const { buckets, bucketObjects, bucketsStatus, objectsStatus } =
    useAppSelector((state) => state.s3);

  useEffect(() => {
    dispatch(fetchBuckets());
  }, [dispatch]);

  useEffect(() => {
    if (selectedBucket) {
      dispatch(fetchBucketContents(selectedBucket));
    }
  }, [selectedBucket, dispatch]);

  const handleBucketChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;

    dispatch(setSelectedBucket(value));
    onBucketChange(value);
  };

  const handleObjectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onObjectChange(e.target.value);
  };

  return (
    <div className="flex flex-col gap-4">
      <Select
        isRequired
        isLoading={bucketsStatus === LoadingStatus.Loading}
        label="S3 Bucket"
        value={selectedBucket}
        onChange={handleBucketChange}
      >
        {buckets.map((bucket) => (
          <SelectItem key={bucket.name}>{bucket.name}</SelectItem>
        ))}
      </Select>

      <Select
        isRequired
        isDisabled={!selectedBucket}
        isLoading={objectsStatus === LoadingStatus.Loading}
        label="S3 Object"
        value={selectedObject}
        onChange={handleObjectChange}
      >
        {bucketObjects.map((obj) => (
          <SelectItem key={obj.key}>{obj.key}</SelectItem>
        ))}
      </Select>
    </div>
  );
}
