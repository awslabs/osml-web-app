// Copyright Amazon.com, Inc. or its affiliates.
import { useCallback, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";

import {
  selectShouldUpdatePolling,
  selectSmartPollingInterval
} from "../store/selectors/smart-polling-selectors";
import {
  setPolling,
  setPollingConfig
} from "../store/slices/bedrock-quota-slice";
import { useQuotaUsage } from "./use-quota-usage";

/**
 * Custom hook that manages smart quota polling based on UI state and user activity
 */
export function useSmartQuotaPolling() {
  const dispatch = useDispatch();
  const { fetchQuotaUsage } = useQuotaUsage();

  const pollingUpdate = useSelector(selectShouldUpdatePolling);
  const smartPolling = useSelector(selectSmartPollingInterval);

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const currentConfigRef = useRef<{ interval: number; reason: string } | null>(
    null
  );

  // Clear existing polling interval
  const clearPollingInterval = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Start polling with specified interval
  const startPolling = useCallback(
    (interval: number, reason: string) => {
      clearPollingInterval();

      if (interval === 0) {
        dispatch(setPolling(false));
        dispatch(setPollingConfig({ interval: 0, reason }));

        return;
      }

      // Immediate fetch
      fetchQuotaUsage();

      // Set up interval
      pollingIntervalRef.current = setInterval(() => {
        fetchQuotaUsage();
      }, interval);

      dispatch(setPolling(true));
      dispatch(setPollingConfig({ interval, reason }));
      currentConfigRef.current = { interval, reason };
    },
    [clearPollingInterval, dispatch, fetchQuotaUsage]
  );

  // Update polling when smart polling config changes
  useEffect(() => {
    if (pollingUpdate.shouldUpdate) {
      const { newInterval, pollingConfig } = pollingUpdate;

      startPolling(newInterval, pollingConfig.reason);
    }
  }, [pollingUpdate, startPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearPollingInterval();
    };
  }, [clearPollingInterval]);

  // Manual polling control methods
  const pausePolling = useCallback(() => {
    clearPollingInterval();
    dispatch(setPolling(false));
  }, [clearPollingInterval, dispatch]);

  const resumePolling = useCallback(() => {
    const { interval, reason } = smartPolling;

    if (interval > 0) {
      startPolling(interval, reason);
    }
  }, [smartPolling, startPolling]);

  const forceUpdate = useCallback(() => {
    fetchQuotaUsage();
  }, [fetchQuotaUsage]);

  return {
    isPolling: smartPolling.shouldPoll,
    currentInterval: smartPolling.interval,
    pollingReason: smartPolling.reason,
    pollingConfig: smartPolling,
    pausePolling,
    resumePolling,
    forceUpdate
  };
}
