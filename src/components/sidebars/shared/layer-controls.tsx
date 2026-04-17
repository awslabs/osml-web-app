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
import { ImageProcessingJob } from "@/services/model-runner-service";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchCollections } from "@/store/slices/data-catalog-slice";
import {
  deleteJob,
  fetchGeoJSONData,
  fetchJobs,
  fetchViewpointStatus,
  selectHasIncompleteJobs,
  selectJobs,
  selectJobsRefreshing,
  startJobsPolling,
  stopJobsPolling
} from "@/store/slices/jobs-slice";

export const LayerControls = ({ children }: { children?: ReactNode }) => {
  const dispatch = useAppDispatch();

  // Redux state
  const jobs = useAppSelector(selectJobs);
  const isRefreshing = useAppSelector(selectJobsRefreshing);
  const hasIncompleteJobs = useAppSelector(selectHasIncompleteJobs);
  const overlayLayers = useAppSelector((state) => state.overlay.layers);

  // Create modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<ImageProcessingJob | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Smart polling — start/stop based on incomplete jobs
  useEffect(() => {
    if (hasIncompleteJobs) {
      dispatch(startJobsPolling());
    } else {
      dispatch(stopJobsPolling());
    }
    return () => {
      dispatch(stopJobsPolling());
    };
  }, [hasIncompleteJobs, dispatch]);

  // Eager detection fetch: auto-dispatch fetchGeoJSONData for SUCCESS jobs
  // without a detection overlay layer. Use a ref to prevent re-dispatch loops.
  const fetchingJobsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    jobs.forEach((job) => {
      if (
        job.status === "SUCCESS" &&
        !fetchingJobsRef.current.has(job.job_id)
      ) {
        const layerId = `detection-${job.job_id}`;
        const layer = overlayLayers[layerId];
        if (
          !layer ||
          (layer.metadata?.loading === false && layer.metadata?.error)
        ) {
          fetchingJobsRef.current.add(job.job_id);
          dispatch(fetchGeoJSONData(job));
          dispatch(fetchViewpointStatus(job.job_id));
        }
      }
    });
  }, [jobs, overlayLayers, dispatch]);

  // Collection refresh: dispatch fetchCollections() when detection data
  // finishes loading (loading transitions from true to false without error).
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
