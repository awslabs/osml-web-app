// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { ChatInterface } from "@/components/chat";
import { GeoAgentSidebar } from "@/components/sidebars/geo-agent-sidebar";
import { Sidebar } from "@/components/sidebars/sidebar";
import { useAppDispatch } from "@/store/hooks";
import { toggleDrawer } from "@/store/slices/navbar-slice";

export default function GeoAgentPage() {
  const dispatch = useAppDispatch();

  const handleOpenServerConfig = () => {
    dispatch(toggleDrawer());
  };

  return (
    <>
      <Sidebar>
        <GeoAgentSidebar />
      </Sidebar>
      <div className="w-full h-full p-4 flex justify-center">
        <div className="w-1/2 h-full">
          <ChatInterface
            className="h-full"
            showHeader={true}
            title="Geospatial Agent"
            variant="full"
            onOpenServerConfig={handleOpenServerConfig}
          />
        </div>
      </div>
    </>
  );
}
