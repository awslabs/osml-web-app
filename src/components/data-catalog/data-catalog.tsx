// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  MagnifyingGlassIcon,
  RectangleStackIcon
} from "@heroicons/react/24/outline";
import { Tab, Tabs } from "@heroui/tabs";

import { useViewpointWarming } from "@/hooks/use-viewpoint-warming";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectActiveTab,
  setActiveTab
} from "@/store/slices/data-catalog-slice";

import { StacCollectionsList } from "./stac-collections-list";
import { StacItemBrowser } from "./stac-item-browser";
import { StacItemDetailsModal } from "./stac-item-details-modal";
import { StacSearchPanel } from "./stac-search-panel";

interface DataCatalogProps {
  className?: string;
}

export const DataCatalog = ({ className }: DataCatalogProps) => {
  const dispatch = useAppDispatch();
  const activeTab = useAppSelector(selectActiveTab);

  // Automatically warm viewpoints for all STAC items with image assets
  useViewpointWarming();

  const handleTabChange = (key: string | number) => {
    dispatch(setActiveTab(key as "collections" | "search"));
  };

  return (
    <div className={className}>
      <div className="space-y-4">
        <Tabs
          aria-label="Data Catalog Options"
          selectedKey={activeTab}
          size="sm"
          variant="underlined"
          onSelectionChange={handleTabChange}
        >
          <Tab
            key="collections"
            title={
              <div className="flex items-center gap-2">
                <RectangleStackIcon className="w-4 h-4" />
                <span>Collections</span>
              </div>
            }
          >
            <div className="mt-4">
              <StacCollectionsList />
            </div>
          </Tab>

          <Tab
            key="search"
            title={
              <div className="flex items-center gap-2">
                <MagnifyingGlassIcon className="w-4 h-4" />
                <span>Search</span>
              </div>
            }
          >
            <div className="mt-4 space-y-4">
              <StacSearchPanel />
              <StacItemBrowser />
            </div>
          </Tab>
        </Tabs>

        {/* Global Details Modal */}
        <StacItemDetailsModal />
      </div>
    </div>
  );
};
