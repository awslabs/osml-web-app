// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { Button } from "@heroui/button";
import { Spinner } from "@heroui/spinner";
import React, {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import { CreateIcon } from "@/components/icons";
import { CreateJobModal } from "@/components/modals/create-image-job-modal";
import { DeleteConfirmationModal } from "@/components/modals/delete-confirmation-modal";
import { useJobsPolling } from "@/hooks/use-jobs-polling";
import { isJobComplete } from "@/services/job-management";
import { ImageProcessingJob } from "@/services/model-runner-service";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchCollections } from "@/store/slices/data-catalog-slice";
import {
  deleteJob,
  fetchJobs,
  selectJobs,
  selectJobsRefreshing
} from "@/store/slices/jobs-slice";

/**
 * Delay between observing a job's completion and refreshing the STAC
 * catalog. Gives the catalog ingest pipeline a moment to index the newly
 * produced detection items so the collection counts reflect reality.
 */
const STAC_INGEST_REFRESH_DELAY_MS = 3000;

export const LayerControls = ({ children }: { children?: ReactNode }) => {
  const dispatch = useAppDispatch();

  // Redux state
  const jobs = useAppSelector(selectJobs);
  const isRefreshing = useAppSelector(selectJobsRefreshing);
  const overlayLayers = useAppSelector((state) => state.overlay.layers);

  // Create modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<ImageProcessingJob | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Smart polling — refresh the job list while any job is in progress.
  useJobsPolling();

  // Collection refresh: dispatch fetchCollections() when a job's detection
  // data finishes loading (the overlay layer transitions from loading to
  // loaded without error). This keeps the STAC catalog collection item
  // counts in sync with newly indexed detections.
  const refreshedCollectionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let shouldRefresh = false;
    jobs.forEach((job) => {
      const layerId = `detection-${job.job_id}`;
      const layer = overlayLayers[layerId];
      if (
        layer &&
        layer.metadata?.loading === false &&
        !layer.metadata?.error &&
        !refreshedCollectionsRef.current.has(job.job_id)
      ) {
        refreshedCollectionsRef.current.add(job.job_id);
        shouldRefresh = true;
      }
    });
    if (shouldRefresh) {
      dispatch(fetchCollections());
    }
  }, [jobs, overlayLayers, dispatch]);

  // Collection refresh on job completion: when a job transitions to a
  // terminal status (SUCCESS / PARTIAL / FAILED), refresh the STAC
  // collections after a brief delay so the catalog has time to index the
  // job's detection items. This keeps the catalog item counts up to date
  // even if the user never toggles the job's layers visible.
  //
  // Tracked per-job to detect the transition rather than the initial
  // status on mount, and coalesced into a single timer so a batch of
  // jobs completing around the same time triggers exactly one refresh.
  const previousJobStatusesRef = useRef<Map<string, string>>(new Map());
  const pendingCatalogRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  useEffect(() => {
    const previousStatuses = previousJobStatusesRef.current;
    let transitionObserved = false;

    jobs.forEach((job) => {
      const prevStatus = previousStatuses.get(job.job_id);
      const currStatus = job.status;

      // Only fire on an observed transition from non-terminal to terminal.
      // Jobs we've never seen before are seeded below without triggering,
      // so existing completed jobs on initial page load don't spam the
      // refresh.
      if (
        prevStatus !== undefined &&
        !isJobComplete(prevStatus) &&
        isJobComplete(currStatus)
      ) {
        transitionObserved = true;
      }
      previousStatuses.set(job.job_id, currStatus);
    });

    if (transitionObserved) {
      if (pendingCatalogRefreshRef.current) {
        clearTimeout(pendingCatalogRefreshRef.current);
      }
      pendingCatalogRefreshRef.current = setTimeout(() => {
        pendingCatalogRefreshRef.current = null;
        dispatch(fetchCollections());
      }, STAC_INGEST_REFRESH_DELAY_MS);
    }
  }, [jobs, dispatch]);

  // Cleanup pending catalog refresh on unmount so we don't dispatch after
  // the component is gone.
  useEffect(() => {
    return () => {
      if (pendingCatalogRefreshRef.current) {
        clearTimeout(pendingCatalogRefreshRef.current);
        pendingCatalogRefreshRef.current = null;
      }
    };
  }, []);

  // Manual refresh
  const handleManualRefresh = useCallback(() => {
    dispatch(fetchJobs({ isManualRefresh: true }));
  }, [dispatch]);

  // Delete job — listen for custom event from JobList
  useEffect(() => {
    const handleDeleteRequest = (event: Event) => {
      const customEvent = event as CustomEvent<{ job: ImageProcessingJob }>;
      if (customEvent.detail?.job) {
        setJobToDelete(customEvent.detail.job);
        setIsDeleteModalOpen(true);
      }
    };
    window.addEventListener("job-delete-request", handleDeleteRequest);
    return () => {
      window.removeEventListener("job-delete-request", handleDeleteRequest);
    };
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!jobToDelete) return;
    setIsDeleting(true);
    try {
      await dispatch(
        deleteJob({
          jobId: jobToDelete.job_id,
          outputBucket: jobToDelete.output_bucket
        })
      ).unwrap();
      // Refresh collections after deletion completes (STAC items are now removed)
      dispatch(fetchCollections());
      setIsDeleteModalOpen(false);
      setJobToDelete(null);
    } catch {
      // Deletion failed — error is already surfaced via Redux rejected action
      setIsDeleteModalOpen(false);
      setJobToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  }, [jobToDelete, dispatch]);

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 w-full px-2">
          <span className="text-sm font-medium text-default-600">
            Jobs List
          </span>
          <Button
            isIconOnly
            aria-label="Refresh jobs list"
            className="min-w-unit-8 w-unit-8 h-unit-8 flex-shrink-0"
            color="primary"
            isDisabled={isRefreshing}
            size="sm"
            variant="light"
            onPress={handleManualRefresh}
          >
            {isRefreshing ? (
              <Spinner size="sm" variant="dots" />
            ) : (
              <ArrowPathIcon className="h-4 w-4" />
            )}
          </Button>
        </div>
        {children}
        <div className="px-2 pt-2 border-t">
          <Button
            isIconOnly
            aria-label="Create new job"
            className="w-full flex items-center justify-center"
            color="primary"
            variant="light"
            onPress={() => setIsCreateOpen(true)}
          >
            <CreateIcon /> Create Job
          </Button>
        </div>
      </div>

      <CreateJobModal
        isOpen={isCreateOpen}
        onOpenChange={(open: boolean) => setIsCreateOpen(open)}
      />

      <DeleteConfirmationModal
        isLoading={isDeleting}
        isOpen={isDeleteModalOpen}
        itemName={jobToDelete?.job_name || jobToDelete?.job_id}
        itemType="job"
        onDeleteAction={confirmDelete}
        onOpenChange={(open: boolean) => setIsDeleteModalOpen(open)}
      />
    </>
  );
};
