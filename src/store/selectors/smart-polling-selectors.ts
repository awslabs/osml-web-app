// Copyright Amazon.com, Inc. or its affiliates.
import { createSelector } from "@reduxjs/toolkit";

import { RootState } from "../store";

// Smart polling intervals (in milliseconds)
export const POLLING_INTERVALS = {
  ACTIVE: 5000, // 5 seconds when actively chatting
  IDLE: 30000, // 30 seconds when idle but chat page visible
  BACKGROUND: 60000, // 1 minute when chat page not active but widget visible
  SUSPENDED: 0 // No polling when no chat UI visible
} as const;

// Activity timeout thresholds (in milliseconds)
const ACTIVITY_TIMEOUTS = {
  RECENT: 2 * 60 * 1000, // 2 minutes - considered "active"
  IDLE: 10 * 60 * 1000 // 10 minutes - considered "idle"
} as const;

/**
 * Determines if the chat widget is visible and expanded
 */
export const selectIsChatWidgetVisible = createSelector(
  [(state: RootState) => state.navbar.isChatWidgetExpanded],
  (isExpanded) => isExpanded
);

/**
 * Determines the user's activity level based on last activity timestamp
 */
export const selectUserActivityLevel = createSelector(
  [(state: RootState) => state.chatSession.lastUserActivity],
  (lastActivity): "active" | "idle" | "inactive" => {
    if (!lastActivity) return "inactive";

    const now = Date.now();
    const timeSinceActivity = now - lastActivity;

    if (timeSinceActivity < ACTIVITY_TIMEOUTS.RECENT) {
      return "active";
    } else if (timeSinceActivity < ACTIVITY_TIMEOUTS.IDLE) {
      return "idle";
    } else {
      return "inactive";
    }
  }
);

/**
 * Determines the current UI context for polling decisions
 */
export const selectUIContext = createSelector(
  [
    (state: RootState) => state.navbar.currentRoute,
    (state: RootState) => state.navbar.isChatWidgetExpanded
  ],
  (currentRoute, isChatWidgetExpanded) => {
    const isChatPage = currentRoute === "/chat";
    const isWidgetVisible = isChatWidgetExpanded;

    return {
      isChatPage,
      isWidgetVisible,
      hasVisibleChatUI: isChatPage || isWidgetVisible
    };
  }
);

/**
 * Determines if quota usage is currently high and needs frequent monitoring
 * Based on the currently selected model's quota usage
 */
export const selectQuotaUsageLevel = createSelector(
  [
    (state: RootState) => state.bedrockQuota.quotaByModel,
    (state: RootState) => state.bedrockModel?.selectedModel?.modelId
  ],
  (quotaByModel, currentModelId): "low" | "medium" | "high" => {
    if (!currentModelId || !quotaByModel[currentModelId]) return "low";

    const currentQuota = quotaByModel[currentModelId];
    const maxUsage = Math.max(
      currentQuota.usage_percent?.requests || 0,
      currentQuota.usage_percent?.tokens || 0
    );

    if (maxUsage > 85) return "high";
    if (maxUsage > 60) return "medium";

    return "low";
  }
);

/**
 * Main smart polling selector that determines the optimal polling interval
 */
export const selectSmartPollingInterval = createSelector(
  [
    selectUIContext,
    selectUserActivityLevel,
    selectQuotaUsageLevel,
    (state: RootState) => state.bedrockQuota.isPolling
  ],
  (uiContext, activityLevel, quotaLevel) => {
    // If no chat UI is visible, suspend polling
    if (!uiContext.hasVisibleChatUI) {
      return {
        interval: POLLING_INTERVALS.SUSPENDED,
        reason: "no_chat_ui_visible",
        shouldPoll: false
      };
    }

    // Determine base interval based on UI context and activity
    let baseInterval: number;
    let reason: string;

    if (uiContext.isChatPage) {
      // On chat page - use activity-based intervals
      if (activityLevel === "active") {
        baseInterval = POLLING_INTERVALS.ACTIVE;
        reason = "chat_page_active_user";
      } else if (activityLevel === "idle") {
        baseInterval = POLLING_INTERVALS.IDLE;
        reason = "chat_page_idle_user";
      } else {
        baseInterval = POLLING_INTERVALS.BACKGROUND;
        reason = "chat_page_inactive_user";
      }
    } else if (uiContext.isWidgetVisible) {
      // Widget visible but not on chat page
      baseInterval = POLLING_INTERVALS.BACKGROUND;
      reason = "widget_visible_background";
    } else {
      // Fallback case (shouldn't reach here due to hasVisibleChatUI check)
      baseInterval = POLLING_INTERVALS.SUSPENDED;
      reason = "fallback_suspend";
    }

    // Adjust interval based on quota usage level
    let finalInterval = baseInterval;

    if (quotaLevel === "high" && baseInterval > POLLING_INTERVALS.ACTIVE) {
      // More frequent polling when quota is high
      finalInterval = Math.max(POLLING_INTERVALS.ACTIVE, baseInterval / 2);
      reason += "_high_quota";
    } else if (
      quotaLevel === "low" &&
      baseInterval < POLLING_INTERVALS.BACKGROUND
    ) {
      // Less frequent polling when quota is low
      finalInterval = Math.min(
        POLLING_INTERVALS.BACKGROUND,
        baseInterval * 1.5
      );
      reason += "_low_quota";
    }

    return {
      interval: finalInterval,
      reason,
      shouldPoll: finalInterval > 0,
      uiContext,
      activityLevel,
      quotaLevel
    };
  }
);

/**
 * Selector to determine if polling should be paused/resumed based on state changes
 */
export const selectShouldUpdatePolling = createSelector(
  [
    selectSmartPollingInterval,
    (state: RootState) => state.bedrockQuota.currentPollingInterval
  ],
  (smartPolling, currentInterval) => {
    const shouldUpdate = currentInterval !== smartPolling.interval;

    return {
      shouldUpdate,
      newInterval: smartPolling.interval,
      currentInterval,
      pollingConfig: smartPolling
    };
  }
);
