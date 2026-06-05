// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import dynamic from "next/dynamic";

import { ChatWidget } from "@/components/chat/chat-widget.tsx";
import { GlobeViewerSidebar } from "@/components/sidebars/globe-viewer-sidebar.tsx";
import { Sidebar } from "@/components/sidebars/sidebar.tsx";

const Cesium = dynamic(() => import("./cesium.tsx"), { ssr: false });

export default function GlobePage() {
  return (
    <>
      <Sidebar>
        <GlobeViewerSidebar />
      </Sidebar>
      <div className="w-full h-full">
        <Cesium />

        {/* AI Chat Widget - positioned bottom-right */}
        <ChatWidget />
      </div>
    </>
  );
}
