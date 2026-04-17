// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Accordion, AccordionItem } from "@heroui/accordion";

import { AnalyticsPanel } from "@/components/analytics";
import { DataCatalog } from "@/components/data-catalog/data-catalog.tsx";
import { JobList } from "@/components/sidebars/shared/job-list.tsx";
import { LayerControls } from "@/components/sidebars/shared/layer-controls.tsx";
import { MapControls } from "@/components/sidebars/shared/map-controls.tsx";

export const MapViewerSidebar = () => {
  return (
    <div className="space-y-4">
      <Accordion defaultExpandedKeys={["1", "2"]} selectionMode="multiple">
        <AccordionItem
          key="1"
          aria-label="Image Processing Jobs"
          title="Image Processing Jobs"
        >
          <LayerControls>
            <JobList />
          </LayerControls>
        </AccordionItem>

        <AccordionItem key="2" aria-label="Data Catalog" title="Data Catalog">
          <DataCatalog />
        </AccordionItem>

        <AccordionItem
          key="4"
          aria-label="Detection Analytics"
          title="Detection Analytics"
        >
          <AnalyticsPanel />
        </AccordionItem>

        <AccordionItem key="5" aria-label="Map Controls" title="Map Controls">
          <MapControls />
        </AccordionItem>
      </Accordion>
    </div>
  );
};
