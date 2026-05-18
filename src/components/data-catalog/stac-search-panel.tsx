// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  CalendarIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  MapIcon
} from "@heroicons/react/24/outline";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { DateRangePicker } from "@heroui/date-picker";
import { Input } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { Spinner } from "@heroui/spinner";
import { Switch } from "@heroui/switch";
import { SharedSelection } from "@heroui/system";
import { parseDate } from "@internationalized/date";
import { useEffect, useState } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearSearchResults,
  searchStacItems,
  selectCollections,
  selectSearchFilters,
  selectSearchResults,
  setCollectionFilter,
  setDateRangeFilter,
  setQueryFilter,
  toggleBboxFilter
} from "@/store/slices/data-catalog-slice";
import { fetchCollections } from "@/store/slices/data-catalog-slice";

interface StacSearchPanelProps {
  className?: string;
}

export const StacSearchPanel = ({ className }: StacSearchPanelProps) => {
  const dispatch = useAppDispatch();
  const collections = useAppSelector(selectCollections);
  const filters = useAppSelector(selectSearchFilters);
  const searchResults = useAppSelector(selectSearchResults);
  const viewport = useAppSelector((state) => state.viewport);

  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(
    new Set(filters.collections)
  );

  // Sync local selection with filters.collections.
  const [filtersCollectionsRef, setFiltersCollectionsRef] = useState(
    filters.collections
  );
  if (filtersCollectionsRef !== filters.collections) {
    setFiltersCollectionsRef(filters.collections);
    setSelectedCollections(new Set(filters.collections));
  }

  // Load collections on mount
  useEffect(() => {
    if (!collections.hasLoaded && !collections.loading) {
      dispatch(fetchCollections());
    }
  }, [dispatch, collections.hasLoaded, collections.loading]);

  const handleSearch = () => {
    dispatch(searchStacItems());
  };

  const handleClearResults = () => {
    dispatch(clearSearchResults());
  };

  const handleCollectionSelectionChange = (keys: SharedSelection) => {
    const newSelection =
      keys === "all"
        ? new Set<string>()
        : new Set(Array.from(keys).map(String));

    setSelectedCollections(newSelection);
    dispatch(setCollectionFilter(Array.from(newSelection)));
  };

  const handleQueryChange = (value: string) => {
    dispatch(setQueryFilter(value));
  };

  const handleBboxToggle = () => {
    dispatch(toggleBboxFilter());
  };

  const formatBboxDisplay = () => {
    if (!viewport || !filters.useBboxFilter) return null;

    return `${viewport.extent.west.toFixed(2)}, ${viewport.extent.south.toFixed(2)}, ${viewport.extent.east.toFixed(2)}, ${viewport.extent.north.toFixed(2)}`;
  };

  return (
    <div className={className}>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2 px-1">
          <FunnelIcon className="w-4 h-4 text-primary" />
          <span className="text-small font-medium text-default-600">
            Search Filters
          </span>
        </div>

        {/* Collections Filter */}
        <div className="space-y-1">
          <div className="text-small font-medium text-default-600">
            Collections
          </div>
          {collections.loading ? (
            <div className="flex items-center gap-2 p-2">
              <Spinner size="sm" variant="dots" />
              <span className="text-small text-default-500">
                Loading collections...
              </span>
            </div>
          ) : (
            <Select
              aria-label="Select collections"
              placeholder="All collections"
              selectedKeys={selectedCollections}
              selectionMode="multiple"
              size="sm"
              onSelectionChange={handleCollectionSelectionChange}
            >
              {collections.data.map((collection) => (
                <SelectItem
                  key={collection.id}
                  textValue={collection.title || collection.id}
                >
                  <div className="flex flex-col">
                    <span className="text-small">
                      {collection.title || collection.id}
                    </span>
                    <span className="text-tiny text-default-400">
                      {collection.itemCount?.toLocaleString() || 0} items
                    </span>
                  </div>
                </SelectItem>
              ))}
            </Select>
          )}
          {selectedCollections.size > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {Array.from(selectedCollections).map((collectionId) => {
                const collection = collections.data.find(
                  (c) => c.id === collectionId
                );

                return (
                  <Chip
                    key={collectionId}
                    size="sm"
                    variant="flat"
                    onClose={() => {
                      const newSelection = new Set(selectedCollections);

                      newSelection.delete(collectionId);
                      handleCollectionSelectionChange(newSelection);
                    }}
                  >
                    {collection?.title || collectionId}
                  </Chip>
                );
              })}
            </div>
          )}
        </div>

        {/* Spatial Filter */}
        <div className="space-y-1">
          <Switch
            isSelected={filters.useBboxFilter}
            size="sm"
            onValueChange={handleBboxToggle}
          >
            <div className="flex items-center gap-2">
              <MapIcon className="w-4 h-4" />
              <span className="text-small">Filter by current map view</span>
            </div>
          </Switch>
          {filters.useBboxFilter && (
            <div className="ml-6 text-tiny text-default-500">
              Bbox: {formatBboxDisplay()}
            </div>
          )}
        </div>

        {/* Text Search */}
        <div className="space-y-1">
          <div className="text-small font-medium text-default-600">
            Search Terms
          </div>
          <Input
            placeholder="e.g., Cuba, Landsat, forest..."
            size="sm"
            value={filters.query}
            onValueChange={handleQueryChange}
          />
          <div className="text-tiny text-default-400">
            Search across item titles, descriptions, and properties
          </div>
        </div>

        {/* Date Range Filter */}
        <div className="space-y-1">
          <div className="text-small font-medium text-default-600">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-4 h-4" />
              Date Range
            </div>
          </div>
          <DateRangePicker
            showMonthAndYearPickers
            size="sm"
            value={
              filters.dateRange.start && filters.dateRange.end
                ? {
                    start: parseDate(filters.dateRange.start.split("T")[0]),
                    end: parseDate(filters.dateRange.end.split("T")[0])
                  }
                : null
            }
            onChange={(range) => {
              if (range) {
                // Convert CalendarDate to ISO string with time
                const startDate = new Date(
                  range.start.year,
                  range.start.month - 1,
                  range.start.day,
                  0,
                  0,
                  0
                );
                const endDate = new Date(
                  range.end.year,
                  range.end.month - 1,
                  range.end.day,
                  23,
                  59,
                  59
                );

                dispatch(
                  setDateRangeFilter({
                    start: startDate.toISOString(),
                    end: endDate.toISOString()
                  })
                );
              } else {
                dispatch(setDateRangeFilter({ start: null, end: null }));
              }
            }}
          />
          <div className="text-tiny text-default-400">
            Select date range to filter STAC items by acquisition time
          </div>
        </div>

        {/* Search Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            className="flex-1"
            color="primary"
            isLoading={searchResults.loading}
            size="sm"
            startContent={<MagnifyingGlassIcon className="w-4 h-4" />}
            onPress={handleSearch}
          >
            {searchResults.loading ? "Searching..." : "Search"}
          </Button>
          {searchResults.features.length > 0 && (
            <Button
              color="default"
              size="sm"
              variant="light"
              onPress={handleClearResults}
            >
              Clear
            </Button>
          )}
        </div>

        {/* Search Summary */}
        {searchResults.features.length > 0 && (
          <div className="text-small text-default-600 pt-1 border-t border-default-200">
            Found {searchResults.totalCount.toLocaleString()} items
            {searchResults.features.length < searchResults.totalCount &&
              ` (showing ${searchResults.features.length})`}
          </div>
        )}

        {/* Error Display */}
        {searchResults.error && (
          <div className="text-small text-danger bg-danger-50 p-2 rounded-md">
            {searchResults.error}
          </div>
        )}
      </div>
    </div>
  );
};
