// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  EyeIcon,
  EyeSlashIcon,
  RectangleStackIcon
} from "@heroicons/react/24/outline";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { ScrollShadow } from "@heroui/scroll-shadow";
import { Spinner } from "@heroui/spinner";
import type { StacItem } from "stac-ts";

import { useStacItemVisibility } from "@/hooks/use-stac-item-visibility";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectSearchResults,
  showItemDetails
} from "@/store/slices/data-catalog-slice";

import { StacItemCard } from "./stac-item-card";

interface StacItemBrowserProps {
  className?: string;
}

export const StacItemBrowser = ({ className }: StacItemBrowserProps) => {
  const dispatch = useAppDispatch();
  const searchResults = useAppSelector(selectSearchResults);
  const { handleToggleVisibility, isItemVisible } = useStacItemVisibility();

  const handleShowDetails = (item: StacItem, index: number) => {
    dispatch(showItemDetails({ item, index }));
  };

  // Don't render if no search has been performed
  if (
    searchResults.features.length === 0 &&
    !searchResults.loading &&
    !searchResults.error
  ) {
    return null;
  }

  return (
    <div className={className}>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2 px-1">
          <RectangleStackIcon className="w-4 h-4 text-primary" />
          <span className="text-small font-medium text-default-600">
            Search Results
          </span>
          {searchResults.features.length > 0 && (
            <Chip size="sm" variant="flat">
              {searchResults.features.length}
            </Chip>
          )}
        </div>

        {/* Loading State */}
        {searchResults.loading && (
          <div className="flex items-center justify-center py-6">
            <div className="flex items-center gap-2">
              <Spinner size="sm" variant="dots" />
              <span className="text-small text-default-500">
                Searching STAC catalog...
              </span>
            </div>
          </div>
        )}

        {/* Error State */}
        {searchResults.error && (
          <div className="text-small text-danger bg-danger-50 p-2 rounded-md">
            <div className="font-medium">Search Error</div>
            <div className="mt-1">{searchResults.error}</div>
          </div>
        )}

        {/* Results List */}
        {searchResults.features.length > 0 && (
          <ScrollShadow className="max-h-80">
            <div className="space-y-1">
              {searchResults.features.map((item, index) => {
                const isVisible = isItemVisible(item.id);

                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 p-2 rounded-md border border-default-200 hover:border-default-300 transition-colors"
                  >
                    {/* Clickable Item Card */}
                    <div
                      aria-label={`View details for ${item.properties?.title || item.id}`}
                      className="flex-1 min-w-0 cursor-pointer rounded-sm focus:outline-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-primary"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleShowDetails(item, index)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleShowDetails(item, index);
                        }
                      }}
                    >
                      <StacItemCard item={item} />
                    </div>

                    {/* Show/Hide Toggle */}
                    <Button
                      isIconOnly
                      aria-label={
                        isVisible
                          ? `Hide ${item.properties?.title || item.id}`
                          : `Show ${item.properties?.title || item.id}`
                      }
                      color={isVisible ? "primary" : "default"}
                      size="sm"
                      variant={isVisible ? "solid" : "light"}
                      onPress={() => handleToggleVisibility(item.id)}
                    >
                      {isVisible ? (
                        <EyeIcon className="w-4 h-4" />
                      ) : (
                        <EyeSlashIcon className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollShadow>
        )}

        {/* Pagination Info */}
        {searchResults.totalCount > searchResults.features.length && (
          <div className="text-center text-small text-default-500 pt-1 border-t border-default-200">
            Showing {searchResults.features.length} of{" "}
            {searchResults.totalCount.toLocaleString()} items
            <div className="text-tiny mt-1">
              Refine your search to see more specific results
            </div>
          </div>
        )}

        {/* Empty Results */}
        {searchResults.features.length === 0 &&
          !searchResults.loading &&
          !searchResults.error && (
            <div className="flex flex-col items-center justify-center py-6 space-y-2">
              <RectangleStackIcon className="w-6 h-6 text-default-300" />
              <span className="text-small text-default-500">
                No items found
              </span>
              <span className="text-tiny text-default-400 text-center">
                Try adjusting your search filters or expanding your search area
              </span>
            </div>
          )}
      </div>
    </div>
  );
};
