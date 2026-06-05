// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import dynamic from "next/dynamic";

import { ChatWidget } from "@/components/chat/chat-widget.tsx";
import { MapViewerSidebar } from "@/components/sidebars/map-viewer-sidebar.tsx";
import { Sidebar } from "@/components/sidebars/sidebar.tsx";

const MapViewer = dynamic(() => import("./map-viewer.tsx"), { ssr: false });

export default function MapPage() {
  return (
    <>
      <Sidebar>
        <MapViewerSidebar />
      </Sidebar>
      <div className="w-full h-full">
        <MapViewer />

        {/* AI Chat Widget - positioned bottom-right */}
        <ChatWidget />
      </div>
    </>
  );
}
