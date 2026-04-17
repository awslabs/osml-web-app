// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  RectangleStackIcon
} from "@heroicons/react/24/outline";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Listbox, ListboxItem } from "@heroui/listbox";
import { Spinner } from "@heroui/spinner";
import { Tooltip } from "@heroui/tooltip";
import { useEffect } from "react";

import { StacCollection } from "@/services/data-catalog-service";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchCollections,
  selectCollections
} from "@/store/slices/data-catalog-slice";

interface StacCollectionsListProps {
  className?: string;
}

export const StacCollectionsList = ({
  className
}: StacCollectionsListProps) => {
  const dispatch = useAppDispatch();
  const {
    data: collections,
    loading: isLoading,
    error
  } = useAppSelector(selectCollections);

  // Initial load
  useEffect(() => {
    if (collections.length === 0 && !isLoading) {
      dispatch(fetchCollections());
    }
  }, [dispatch, collections.length, isLoading]);

  const handleRefresh = () => {
    dispatch(fetchCollections());
  };

  const renderCollectionItem = (collection: StacCollection) => {
    const itemCount = collection.itemCount || 0;
    const hasItems = itemCount > 0;

    return (
      <ListboxItem
        key={collection.id}
        className="gap-1"
        textValue={collection.title || collection.id}
      >
        <div className="flex items-center gap-2">
          <div className="flex flex-col">
            {collection.description ? (
              <Tooltip content={collection.description} placement="top">
                <span className="text-small font-medium cursor-help">
                  {collection.title || collection.id}
                </span>
              </Tooltip>
            ) : (
              <span className="text-small font-medium">
                {collection.title || collection.id}
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Chip
              color={hasItems ? "primary" : "default"}
              size="sm"
              variant={hasItems ? "flat" : "faded"}
            >
              {itemCount.toLocaleString()} items
            </Chip>
          </div>
        </div>
      </ListboxItem>
    );
  };

  if (isLoading && collections.length === 0) {
    return (
      <Card className={className}>
        <CardBody className="flex items-center justify-center py-8">
          <Spinner size="md" variant="dots" />
          <span className="text-small text-default-500 mt-2">
            Loading collections...
          </span>
        </CardBody>
      </Card>
    );
  }

  if (error && collections.length === 0) {
    return (
      <Card className={className}>
        <CardBody className="flex flex-col items-center justify-center py-8 space-y-2">
          <ExclamationTriangleIcon className="w-8 h-8 text-danger" />
          <span className="text-small text-danger text-center">{error}</span>
          <Button size="sm" variant="light" onPress={handleRefresh}>
            Try Again
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className={className}>
      {/* Header with refresh button */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-small font-medium text-default-600">
          STAC Collections ({collections.length})
        </span>
        <Button
          isIconOnly
          aria-label="Refresh collections"
          className="min-w-unit-6 w-unit-6 h-unit-6"
          color="primary"
          isDisabled={isLoading}
          size="sm"
          variant="light"
          onPress={handleRefresh}
        >
          {isLoading ? (
            <Spinner size="sm" variant="dots" />
          ) : (
            <ArrowPathIcon className="h-3 w-3" />
          )}
        </Button>
      </div>

      {/* Collections list */}
      {collections.length > 0 ? (
        <Card>
          <CardBody className="p-0">
            <Listbox
              aria-label="STAC Collections"
              className="p-0 gap-0 divide-y divide-default-300/50 dark:divide-default-100/80 bg-content1 max-w-[300px] overflow-visible shadow-small rounded-medium"
              itemClasses={{
                base: "px-3 first:rounded-t-medium last:rounded-b-medium rounded-none gap-3 h-12 data-[hover=true]:bg-default-100/80"
              }}
            >
              {collections.map((collection) =>
                renderCollectionItem(collection)
              )}
            </Listbox>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="flex flex-col items-center justify-center py-8 space-y-2">
            <RectangleStackIcon className="w-8 h-8 text-default-300" />
            <span className="text-small text-default-500">
              No collections found
            </span>
            <span className="text-tiny text-default-400 text-center">
              Upload GeoJSON files to create collections
            </span>
          </CardBody>
        </Card>
      )}

      {error && collections.length > 0 && (
        <div className="text-tiny text-warning mt-2">
          Warning: Some collection data may be outdated
        </div>
      )}
    </div>
  );
};
