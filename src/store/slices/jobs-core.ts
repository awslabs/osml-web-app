// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Core jobs slice: state shape, reducers, extraReducers, action creators and
 * selectors. The async thunks it reacts to (`fetchJobs`, `deleteJob`) live in
 * `jobs-thunks.ts`; the selection→layer reconciliation middleware lives in
 * `jobs-middleware.ts`. Consumers should import from the `jobs-slice.ts`
 * barrel, which re-exports all of these together.
 */
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

import { DEFAULT_RESULT_OPACITY } from "@/config/model-runner-defaults";
import { isJobComplete } from "@/services/job-management";
import { ImageProcessingJob } from "@/services/model-runner-service.ts";
import { RootState } from "@/store/store.ts";
import { CLASSIFICATION_PALETTE } from "@/utils/analytics/types";

import { deleteJob, fetchJobs } from "./jobs-thunks";

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_RESULT_STYLE: VectorStyle = {
  color: CLASSIFICATION_PALETTE[0],
  opacity: DEFAULT_RESULT_OPACITY
};

/**
 * Pick the first palette color not present in `usedColors`, falling back to
 * the first palette entry when every color is already taken. Shared by the
 * sites that auto-assign layer colors so the selection logic stays in sync.
 */
function nextPaletteColor(usedColors: Set<string>): string {
  return (
    CLASSIFICATION_PALETTE.find((c) => !usedColors.has(c)) ??
    CLASSIFICATION_PALETTE[0]
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VectorStyle {
  color: string; // HTML color string (e.g., '#ff0000')
  opacity: number; // 0-1 value
}

export interface JobsListState {
  jobs: ImageProcessingJob[];
  customOrder: string[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
}

export interface JobSelectionState {
  selectedJobs: ImageProcessingJob[];
  layerStyles: Record<string, VectorStyle>;
}

export interface JobsState {
  jobsList: JobsListState;
  selection: JobSelectionState;
}

export interface JobSnapshot {
  job: ImageProcessingJob;
  orderIndex: number;
  wasSelected: boolean;
  layerStyle?: VectorStyle;
}

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: JobsState = {
  jobsList: {
    jobs: [],
    customOrder: [],
    isLoading: false,
    isRefreshing: false,
    error: null
  },
  selection: {
    selectedJobs: [],
    layerStyles: {}
  }
};

// ─── Slice ───────────────────────────────────────────────────────────────────

export const jobsSlice = createSlice({
  name: "jobs",
  initialState,
  reducers: {
    setSelectedJobs: (state, action: PayloadAction<ImageProcessingJob[]>) => {
      // Auto-assign palette colors to newly selected jobs that don't have a style yet.
      // Existing styles persist across deselect/reselect — they are only cleared
      // when a job is deleted (removeJobOptimistically / deleteJob.pending).
      const usedColors = new Set(
        Object.values(state.selection.layerStyles).map((s) => s.color)
      );

      for (const job of action.payload) {
        if (!state.selection.layerStyles[job.job_id]) {
          const color = nextPaletteColor(usedColors);
          state.selection.layerStyles[job.job_id] = {
            color,
            opacity: DEFAULT_RESULT_STYLE.opacity
          };
          usedColors.add(color);
        }
      }

      state.selection.selectedJobs = action.payload;
    },
    setJobsCustomOrder: (state, action: PayloadAction<string[]>) => {
      state.jobsList.customOrder = action.payload;
    },
    addJobToOrder: (state, action: PayloadAction<{ jobId: string }>) => {
      if (!state.jobsList.customOrder.includes(action.payload.jobId)) {
        state.jobsList.customOrder = [
          action.payload.jobId,
          ...state.jobsList.customOrder
        ];
      }
    },
    removeJobOptimistically: (
      state,
      action: PayloadAction<{ jobId: string }>
    ) => {
      const { jobId } = action.payload;

      state.jobsList.jobs = state.jobsList.jobs.filter(
        (j) => j.job_id !== jobId
      );
      state.jobsList.customOrder = state.jobsList.customOrder.filter(
        (id) => id !== jobId
      );
      state.selection.selectedJobs = state.selection.selectedJobs.filter(
        (j) => j.job_id !== jobId
      );
      delete state.selection.layerStyles[jobId];
    },
    restoreJob: (state, action: PayloadAction<JobSnapshot>) => {
      const { job, orderIndex, wasSelected, layerStyle } = action.payload;

      // Restore job to jobs list at original position if possible
      const currentJobs = [...state.jobsList.jobs];
      if (orderIndex >= 0 && orderIndex <= currentJobs.length) {
        currentJobs.splice(orderIndex, 0, job);
      } else {
        currentJobs.push(job);
      }
      state.jobsList.jobs = currentJobs;

      // Restore to custom order at original position if possible
      const currentOrder = [...state.jobsList.customOrder];
      if (orderIndex >= 0 && orderIndex <= currentOrder.length) {
        currentOrder.splice(orderIndex, 0, job.job_id);
      } else {
        currentOrder.push(job.job_id);
      }
      state.jobsList.customOrder = currentOrder;

      // Restore selection state if it was selected
      if (wasSelected) {
        state.selection.selectedJobs = [...state.selection.selectedJobs, job];
      }

      // Restore layer style if it existed
      if (layerStyle) {
        state.selection.layerStyles[job.job_id] = layerStyle;
      }
    },
    setLayerStyle: (
      state,
      action: PayloadAction<{ jobId: string; style: VectorStyle }>
    ) => {
      state.selection.layerStyles[action.payload.jobId] = action.payload.style;
    },
    setDefaultStyle: (state, action: PayloadAction<{ jobId: string }>) => {
      // Assign next available palette color instead of static yellow
      const usedColors = new Set(
        Object.values(state.selection.layerStyles).map((s) => s.color)
      );
      state.selection.layerStyles[action.payload.jobId] = {
        color: nextPaletteColor(usedColors),
        opacity: DEFAULT_RESULT_STYLE.opacity
      };
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchJobs.pending, (state, action) => {
        if (action.meta.arg?.isManualRefresh) {
          state.jobsList.isRefreshing = true;
        } else if (state.jobsList.jobs.length === 0) {
          state.jobsList.isLoading = true;
        }
      })
      .addCase(fetchJobs.fulfilled, (state, action) => {
        state.jobsList.jobs = action.payload.jobs;
        state.jobsList.isLoading = false;
        state.jobsList.isRefreshing = false;
        state.jobsList.error = null;

        // Initialize custom order if empty
        if (
          state.jobsList.customOrder.length === 0 &&
          action.payload.jobs.length > 0
        ) {
          state.jobsList.customOrder = action.payload.jobs.map(
            (job) => job.job_id
          );
        }

        // Prepend any new job IDs to the existing order
        const existingIds = new Set(state.jobsList.customOrder);
        const newJobIds = action.payload.jobs
          .filter((job) => !existingIds.has(job.job_id))
          .map((job) => job.job_id);
        if (newJobIds.length > 0) {
          state.jobsList.customOrder = [
            ...newJobIds,
            ...state.jobsList.customOrder
          ];
        }

        // Auto-assign palette colors to any jobs that don't have a style yet
        // Sort oldest-first so palette colors match the job list display order
        const jobsSortedOldestFirst = [...action.payload.jobs].sort(
          (a, b) =>
            new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        );
        const usedColors = new Set(
          Object.values(state.selection.layerStyles).map((s) => s.color)
        );
        for (const job of jobsSortedOldestFirst) {
          if (!state.selection.layerStyles[job.job_id]) {
            const color = nextPaletteColor(usedColors);
            state.selection.layerStyles[job.job_id] = {
              color,
              opacity: DEFAULT_RESULT_STYLE.opacity
            };
            usedColors.add(color);
          }
        }
      })
      .addCase(fetchJobs.rejected, (state, action) => {
        state.jobsList.isLoading = false;
        state.jobsList.isRefreshing = false;
        state.jobsList.error = action.error.message || "Failed to load jobs";
      })
      .addCase(deleteJob.pending, (state, action) => {
        const { jobId } = action.meta.arg;

        state.jobsList.jobs = state.jobsList.jobs.filter(
          (j) => j.job_id !== jobId
        );
        state.jobsList.customOrder = state.jobsList.customOrder.filter(
          (id) => id !== jobId
        );
        state.selection.selectedJobs = state.selection.selectedJobs.filter(
          (j) => j.job_id !== jobId
        );
        delete state.selection.layerStyles[jobId];
      })
      .addCase(deleteJob.fulfilled, () => {
        // Partial failures are tracked in the result but don't affect UI state —
        // the job has been removed from the list regardless.
      })
      .addCase(deleteJob.rejected, (state, action) => {
        state.jobsList.error = action.payload?.error || "Failed to delete job";
      });
  }
});

// ─── Action Creators ─────────────────────────────────────────────────────────

export const {
  setSelectedJobs,
  setJobsCustomOrder,
  addJobToOrder,
  removeJobOptimistically,
  restoreJob,
  setLayerStyle,
  setDefaultStyle
} = jobsSlice.actions;

// ─── Selectors ───────────────────────────────────────────────────────────────

export const selectJobs = (state: RootState) => state.jobs.jobsList.jobs;
export const selectJobsCustomOrder = (state: RootState) =>
  state.jobs.jobsList.customOrder;
export const selectJobsLoading = (state: RootState) =>
  state.jobs.jobsList.isLoading;
export const selectJobsRefreshing = (state: RootState) =>
  state.jobs.jobsList.isRefreshing;
export const selectJobsError = (state: RootState) => state.jobs.jobsList.error;
export const selectHasIncompleteJobs = (state: RootState) =>
  state.jobs.jobsList.jobs.some((job) => !isJobComplete(job.status));
export const selectSelectedJobs = (state: RootState) =>
  state.jobs.selection.selectedJobs;
export const selectLayerStyles = (state: RootState) =>
  state.jobs.selection.layerStyles;
export const selectLayerStyle = (state: RootState, jobId: string) =>
  state.jobs.selection.layerStyles[jobId];
export const selectIsJobSelected = (state: RootState, jobId: string) =>
  state.jobs.selection.selectedJobs.some((j) => j.job_id === jobId);

// ─── Default Export ──────────────────────────────────────────────────────────

export default jobsSlice.reducer;
