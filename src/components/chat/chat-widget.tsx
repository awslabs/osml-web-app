// Copyright Amazon.com, Inc. or its affiliates.
"use client";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { Button } from "@heroui/button";
import React from "react";
import { useDispatch, useSelector } from "react-redux";

import { updateUserActivity } from "@/store/slices/chat-session-slice";
import { setChatWidgetExpanded } from "@/store/slices/navbar-slice";
import { RootState } from "@/store/store";

import { ChatInterface } from "./chat-interface";
import { LoadingState, useSystemReady } from "./loading-state";

export interface ChatWidgetProps {
  className?: string;
}

export const ChatWidget: React.FC<ChatWidgetProps> = ({ className = "" }) => {
  const dispatch = useDispatch();
  const isVisible = useSelector(
    (state: RootState) => state.navbar.isChatWidgetExpanded
  );

  // Use shared system readiness hook
  const { isSystemReady } = useSystemReady();

  const handleToggle = () => {
    dispatch(setChatWidgetExpanded(!isVisible));
    // Update user activity when interacting with chat widget
    if (!isVisible) {
      dispatch(updateUserActivity());
    }
  };

  return (
    <div className={`fixed bottom-[36px] right-4 w-12 h-12 z-50 ${className}`}>
      {/* Chat Widget - positioned absolutely above button container */}
      {isVisible && (
        <div
          className="absolute bottom-16 right-0 bg-background border border-default-200 rounded-lg shadow-lg"
          style={{
            width: "320px", // Approximate sidenav width
            height: "40vh" // ~40% page height
          }}
        >
          {!isSystemReady ? (
            // Loading State - using shared component
            <LoadingState />
          ) : (
            // Ready State
            <ChatInterface
              className="h-full text-xs"
              maxHeight="h-full"
              showHeader={false}
              title="AI Assistant"
              variant="widget"
            />
          )}
        </div>
      )}

      {/* AI Toggle Button - absolutely positioned within fixed container */}
      <Button
        isIconOnly
        aria-label={isVisible ? "Close AI Chat" : "Open AI Chat"}
        className="absolute top-0 left-0 w-12 h-12 shadow-lg"
        color="secondary"
        variant="shadow"
        onPress={handleToggle}
      >
        <SparklesIcon className="w-5 h-5" />
      </Button>
    </div>
  );
};
