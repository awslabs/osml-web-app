// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronUpDownIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon
} from "@heroicons/react/16/solid";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@heroui/popover";
import { Slider } from "@heroui/slider";
import { Spinner } from "@heroui/spinner";
import React from "react";
import { useEffect } from "react";

import { DeleteIcon } from "@/components/icons.tsx";
import { ImageProcessingJob } from "@/services/model-runner-service.ts";
import { useAppDispatch, useAppSelector } from "@/store/hooks.ts";
import {
  DEFAULT_RESULT_STYLE,
  selectJobs,
  selectJobsCustomOrder,
  selectJobsError,
  selectJobsLoading,
  selectLayerStyles,
  selectSelectedJobs,
  setJobsCustomOrder,
  setLayerStyle,
  setSelectedJobs
} from "@/store/slices/jobs-slice.ts";
import { setLayerOrder } from "@/store/slices/overlay-slice.ts";

// ─── ColorControls Sub-Component ─────────────────────────────────────────────

const ColorControls = ({ jobId }: { jobId: string }) => {
  const dispatch = useAppDispatch();
  const layerStyles = useAppSelector(selectLayerStyles);
  const style = layerStyles[jobId] || DEFAULT_RESULT_STYLE;

  useEffect(() => {
    document.documentElement.style.setProperty("--slider-color", style.color);
  }, [style.color]);

  return (
    <div
      className="p-2 w-48"
      role="presentation"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Input
        aria-label="Color"
        className="mb-2"
        size="sm"
        type="color"
        value={style.color}
        onChange={(e) => {
          dispatch(
            setLayerStyle({
              jobId,
              style: {
                ...style,
                color: e.target.value
              }
            })
          );
        }}
      />
      <Slider
        aria-label="Opacity"
        classNames={{
          base: "w-full",
          track: "bg-default-100",
          filler: "opacity-slider-fill",
          thumb: [
            "transition-all",
            "bg-background",
            "border-2",
            `border-[${style.color}]`,
            "shadow-lg",
            "data-[dragging=true]:scale-110"
          ]
        }}
        maxValue={1}
        minValue={0}
        size="sm"
        step={0.01}
        value={style.opacity}
        onChange={(value: number | number[]) => {
          dispatch(
            setLayerStyle({
              jobId,
              style: {
                ...style,
                opacity: Array.isArray(value) ? value[0] : value
              }
            })
          );
        }}
      />
    </div>
  );
};

// ─── StatusArea Sub-Component ────────────────────────────────────────────────

const StatusArea = ({
  status,
  isSelected,
  jobId,
  isCataloging,
  hasCatalogError
}: {
  status: string;
  isSelected: boolean;
  jobId: string;
  isCataloging?: boolean;
  hasCatalogError?: boolean;
}) => {
  const layerStyles = useAppSelector(selectLayerStyles);
  const style = layerStyles[jobId] || DEFAULT_RESULT_STYLE;

  if (status !== "SUCCESS") {
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        {status === "PARTIAL" ? (
          <ExclamationTriangleIcon className="w-5 h-5 text-warning" />
        ) : (
          <Spinner size="sm" variant="dots" />
        )}
      </div>
    );
  }

  if (hasCatalogError) {
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        <Chip color="danger" size="sm" variant="flat">
          Catalog Error
        </Chip>
      </div>
    );
  }

  if (isCataloging) {
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        <Spinner size="sm" variant="dots" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <Popover placement="right">
        <PopoverTrigger>
          <div
            className="w-5 h-5 rounded cursor-pointer color-indicator"
            role="button"
            tabIndex={0}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
              }
            }}
            style={{
              border: `2px solid ${style.color}`
            }}
          >
            <div
              className="w-full h-full rounded"
              style={{
                backgroundColor: style.color,
                opacity: style.opacity
              }}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent>
          <ColorControls jobId={jobId} />
        </PopoverContent>
      </Popover>
      {isSelected ? (
        <EyeIcon className="w-5 h-5 text-default-400" />
      ) : (
        <EyeSlashIcon className="w-5 h-5 text-default-400" />
      )}
    </div>
  );
};

// ─── SortableItem Sub-Component ──────────────────────────────────────────────

const SortableItem = ({
  job,
  isSelected,
  disabled,
  onDelete,
  isCataloging,
  hasCatalogError
}: {
  job: ImageProcessingJob;
  isSelected: boolean;
  disabled: boolean;
  onDelete: (jobId: string) => void;
  isCataloging?: boolean;
  hasCatalogError?: boolean;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: job.job_id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      aria-label={job.status}
      aria-selected={isSelected}
      className={`
      flex group gap-2 items-center justify-between relative px-2 py-1.5 w-full h-full
      box-border rounded-small subpixel-antialiased cursor-pointer tap-highlight-transparent
      outline-none data-[focus-visible=true]:z-10 data-[focus-visible=true]:outline-2
      data-[focus-visible=true]:outline-focus data-[focus-visible=true]:outline-offset-2
      data-[focus-visible=true]:dark:ring-offset-background-content1
      transition-colors hover:bg-default hover:text-default-foreground
      ${disabled ? "opacity-50" : "opacity-100"}
      ${isSelected ? "bg-default-100" : ""}
    `}
      data-hover="true"
      role="option"
      style={style}
    >
      <div {...attributes} {...listeners} className="flex items-center">
        <ChevronUpDownIcon className="w-5 h-5 text-default-400 cursor-grab active:cursor-grabbing" />
      </div>
      <div className="w-full flex flex-col items-start justify-center">
        <span className="flex-1 text-small font-normal" data-label="true">
          <div className="flex items-center gap-2">
            {job.job_name || job.job_id}
          </div>
        </span>
        <span className="w-full text-tiny text-foreground-500 group-hover:text-current truncate">
          {job.status === "SUCCESS"
            ? `Duration: ${job.processing_duration}s`
            : job.image_status || "Pending"}
        </span>
      </div>
      <StatusArea
        hasCatalogError={hasCatalogError}
        isCataloging={isCataloging}
        isSelected={isSelected}
        jobId={job.job_id}
        status={job.status}
      />
      <Button
        isIconOnly
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        color="danger"
        size="sm"
        variant="light"
        onPress={() => {
          onDelete(job.job_id);
        }}
      >
        <DeleteIcon />
      </Button>
    </div>
  );
};

// ─── JobList Component ───────────────────────────────────────────────────────

export const JobList = () => {
  const dispatch = useAppDispatch();

  // Redux state from jobs-slice
  const jobs = useAppSelector(selectJobs);
  const customOrder = useAppSelector(selectJobsCustomOrder);
  const isLoading = useAppSelector(selectJobsLoading);
  const error = useAppSelector(selectJobsError);
  const selectedJobs = useAppSelector(selectSelectedJobs);
  const overlayLayers = useAppSelector((state) => state.overlay.layers);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = customOrder.indexOf(active.id as string);
      const newIndex = customOrder.indexOf(over.id as string);
      const newOrder = arrayMove(customOrder, oldIndex, newIndex);

      dispatch(setLayerOrder(newOrder));
      dispatch(setJobsCustomOrder(newOrder));
    }
  };

  /**
   * Toggle whether a job is selected. Selection is the source of truth for
   * "this job's detection and imagery should be rendered on the map/globe";
   * the fetchDataMiddleware reacts to selection changes by creating or
   * tearing down the corresponding overlay layers.
   */
  const handleJobSelection = (jobId: string, disabledKeys: string[]) => {
    if (disabledKeys.includes(jobId)) return;

    const job = jobs.find((j) => j.job_id === jobId);
    if (!job) return;

    const isCurrentlySelected = selectedJobs.some((j) => j.job_id === jobId);
    const nextSelection = isCurrentlySelected
      ? selectedJobs.filter((j) => j.job_id !== jobId)
      : [...selectedJobs, job];

    dispatch(setSelectedJobs(nextSelection));
  };

  const handleDeleteJob = (jobId: string) => {
    // Dispatch a custom event that LayerControls can listen for
    const job = jobs.find((j) => j.job_id === jobId);
    if (!job) return;
    const event = new CustomEvent("job-delete-request", {
      detail: { job }
    });
    window.dispatchEvent(event);
  };

  // Loading state
  if (isLoading && jobs.length === 0) {
    return (
      <div className="p-4 text-center" role="status">
        Loading jobs...
      </div>
    );
  }

  // Error state
  if (error) {
    return <div className="p-4 text-center text-danger">{error}</div>;
  }

  // Empty state
  if (jobs.length === 0) {
    return <div className="p-4 text-center">No jobs found</div>;
  }

  // Sort jobs based on custom order
  const sortedJobs = [...jobs].sort((a, b) => {
    const aIndex = customOrder.indexOf(a.job_id);
    const bIndex = customOrder.indexOf(b.job_id);

    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }

    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  // Disable jobs that aren't in a selectable state:
  //   - Non-SUCCESS jobs (still processing or failed)
  //   - SUCCESS jobs whose detection overlay layer is currently loading
  //     (middleware will auto-register it once selected; disabled here only
  //     when a prior selection left the layer in a loading state)
  const disabledKeys = sortedJobs
    .filter((job) => {
      if (job.status !== "SUCCESS") return true;
      const layerId = `detection-${job.job_id}`;
      const layer = overlayLayers[layerId];
      if (layer && layer.metadata?.loading) return true;
      return false;
    })
    .map((job) => job.job_id);

  const selectedIds = new Set(selectedJobs.map((j) => j.job_id));

  return (
    <DndContext
      collisionDetection={closestCenter}
      sensors={sensors}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={sortedJobs.map((job) => job.job_id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-1">
          {sortedJobs.map((job) => {
            const layerId = `detection-${job.job_id}`;
            const layer = overlayLayers[layerId];
            const isSelected = selectedIds.has(job.job_id);
            // A job is "cataloging" when it's selected (user asked to see
            // it) and the detection layer is still loading. If the layer
            // simply doesn't exist, the job isn't selected yet — no
            // spinner needed.
            const isCataloging =
              isSelected &&
              job.status === "SUCCESS" &&
              (!layer || layer.metadata?.loading === true);
            const hasCatalogError =
              job.status === "SUCCESS" && !!layer?.metadata?.error;

            return (
              <div
                key={job.job_id}
                className="w-full text-left"
                role="button"
                tabIndex={0}
                onClick={() => handleJobSelection(job.job_id, disabledKeys)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleJobSelection(job.job_id, disabledKeys);
                  }
                }}
              >
                <SortableItem
                  disabled={disabledKeys.includes(job.job_id)}
                  hasCatalogError={hasCatalogError}
                  isCataloging={isCataloging}
                  isSelected={isSelected}
                  job={job}
                  onDelete={handleDeleteJob}
                />
              </div>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
};
