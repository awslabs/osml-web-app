// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  ChartBarIcon,
  ClockIcon,
  ExclamationTriangleIcon
} from "@heroicons/react/24/outline";
import { Chip } from "@heroui/chip";
import { Progress } from "@heroui/progress";
import { Tooltip } from "@heroui/tooltip";
import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";

import {
  decrementResetTimers,
  getHighestUsagePercent,
  getQuotaStatusColor,
  selectQuotaForModel
} from "@/store/slices/bedrock-quota-slice";
import { RootState } from "@/store/store";

interface QuotaMeterProps {
  modelId: string;
  variant?: "full" | "compact" | "minimal";
  showDetails?: boolean;
}

export const QuotaMeter = ({
  modelId,
  variant = "full",
  showDetails = true
}: QuotaMeterProps) => {
  const dispatch = useDispatch();
  const quota = useSelector((state: RootState) =>
    selectQuotaForModel(state, modelId)
  );

  // Decrement reset timers every second for smooth countdown
  useEffect(() => {
    const interval = setInterval(() => {
      dispatch(decrementResetTimers());
    }, 1000);

    return () => clearInterval(interval);
  }, [dispatch]);

  // Don't render if no quota limits configured, but show if limits exist even with no usage data
  if (!quota || !quota.has_limits) {
    return null;
  }

  const highestUsage = getHighestUsagePercent(quota);
  const statusColor = getQuotaStatusColor(highestUsage);

  // Determine which resource is limiting (requests or tokens) with safe defaults
  const isRequestsLimiting =
    (quota.usage_percent?.requests || 0) >= (quota.usage_percent?.tokens || 0);
  const limitingResource = isRequestsLimiting ? "requests" : "tokens";
  const limitingPercent = isRequestsLimiting
    ? quota.usage_percent?.requests || 0
    : quota.usage_percent?.tokens || 0;

  // Format numbers for display
  const formatNumber = (num: number): string => {
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}k`;
    }

    return num.toString();
  };

  // Format time remaining
  const formatTimeRemaining = (seconds?: number): string => {
    if (!seconds) return "0s";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (mins > 0) {
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    }

    return `${secs}s`;
  };

  // Minimal variant - just a small indicator
  if (variant === "minimal") {
    return (
      <Tooltip
        content={`Quota: ${limitingPercent.toFixed(0)}% used (${limitingResource})`}
      >
        <Chip
          color={statusColor}
          size="sm"
          startContent={<ChartBarIcon className="w-3 h-3" />}
          variant="flat"
        >
          {limitingPercent.toFixed(0)}%
        </Chip>
      </Tooltip>
    );
  }

  // Compact variant - progress bar only (no percentage text)
  if (variant === "compact") {
    return (
      <div className="min-w-32">
        <Progress
          aria-label={`Quota usage: ${highestUsage.toFixed(0)}%`}
          className="flex-1"
          color={statusColor}
          size="sm"
          value={highestUsage}
        />
      </div>
    );
  }

  // Full variant - comprehensive display
  return (
    <div className="flex flex-col gap-2 p-3 bg-default-50 rounded-lg border border-default-200">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChartBarIcon className="w-4 h-4 text-default-500" />
          <span className="text-sm font-medium">API Quota</span>
        </div>
        {highestUsage >= 80 && (
          <Chip
            color="danger"
            size="sm"
            startContent={<ExclamationTriangleIcon className="w-3 h-3" />}
            variant="flat"
          >
            High Usage
          </Chip>
        )}
      </div>

      {/* Progress Bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-default-500 capitalize">
            {limitingResource}
          </span>
          <span className="text-xs font-medium tabular-nums">
            {limitingPercent.toFixed(1)}%
          </span>
        </div>
        <Progress
          aria-label={`${limitingResource} quota usage`}
          color={statusColor}
          size="sm"
          value={limitingPercent}
        />
      </div>

      {/* Details */}
      {showDetails && quota.remaining && quota.limits && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {/* Requests */}
          <div className="space-y-1">
            <div className="text-default-500">Requests</div>
            <div className="font-medium tabular-nums">
              {formatNumber(quota.remaining.requests || 0)} /{" "}
              {formatNumber(quota.limits.requests_per_minute)}
            </div>
            <div className="text-default-400 text-[10px]">
              remaining / limit
            </div>
          </div>

          {/* Tokens */}
          <Tooltip
            content="Effective tokens with 5x burndown rate for output tokens"
            placement="top"
          >
            <div className="space-y-1">
              <div className="text-default-500">Tokens</div>
              <div className="font-medium tabular-nums">
                {formatNumber(quota.remaining.tokens || 0)} /{" "}
                {formatNumber(quota.limits.tokens_per_minute)}
              </div>
              <div className="text-default-400 text-[10px]">
                remaining / limit
              </div>
            </div>
          </Tooltip>
        </div>
      )}

      {/* Reset Timer */}
      {quota.reset_in_seconds !== undefined && quota.reset_in_seconds > 0 && (
        <div className="flex items-center gap-1 text-xs text-default-500 pt-1 border-t border-default-200">
          <ClockIcon className="w-3 h-3" />
          <span>Resets in {formatTimeRemaining(quota.reset_in_seconds)}</span>
        </div>
      )}

      {/* Warning message at high usage */}
      {highestUsage >= 80 && highestUsage < 90 && (
        <div className="text-xs text-warning bg-warning-50 p-2 rounded">
          ⚠️ Approaching quota limit
        </div>
      )}
      {highestUsage >= 90 && (
        <div className="text-xs text-danger bg-danger-50 p-2 rounded">
          🛑 Near quota limit - requests may be throttled
        </div>
      )}
    </div>
  );
};
