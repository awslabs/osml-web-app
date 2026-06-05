// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchJobs, selectHasIncompleteJobs } from "@/store/slices/jobs-slice";

/** Interval between automatic job-list refreshes while jobs are in progress. */
const JOB_POLL_INTERVAL = 10000; // 10 seconds

/**
 * Smart polling for the job list: while any job is incomplete, dispatch
 * `fetchJobs` every {@link JOB_POLL_INTERVAL} ms; stop as soon as no
 * incomplete jobs remain (or on unmount).
 *
 * Replaces the former module-level `setInterval` singleton in `jobs-slice`
 * (`startJobsPolling`/`stopJobsPolling`) with an effect-scoped lifecycle, so
 * there is no shared mutable interval handle living outside React.
 */
export function useJobsPolling(): void {
  const dispatch = useAppDispatch();
  const hasIncompleteJobs = useAppSelector(selectHasIncompleteJobs);

  useEffect(() => {
    if (!hasIncompleteJobs) return;

    const intervalId = setInterval(() => {
      dispatch(fetchJobs({}));
    }, JOB_POLL_INTERVAL);

    return () => clearInterval(intervalId);
  }, [hasIncompleteJobs, dispatch]);
}
