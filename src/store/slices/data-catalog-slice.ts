// Copyright Amazon.com, Inc. or its affiliates.
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { StacItem } from "stac-ts";

import {
  dataCatalogService,
  StacCollection
} from "@/services/data-catalog-service";
import { viewpointService } from "@/services/viewpoint-service";
import { RootState } from "@/store/store";
import { getViewpointRequestFromStacItem } from "@/utils/stac-viewpoint-utils";

// Types
interface SearchFilters {
  collections: string[];
  bbox: number[] | null;
  useBboxFilter: boolean;
  dateRange: {
    start: string | null; // ISO date string
    end: string | null; // ISO date string
  };
  query: string;
  limit: number;
}

interface SearchResults {
  features: StacItem[];
  totalCount: number;
  loading: boolean;
  error: string | null;
}

interface ItemViewpointState {
  viewpointId: string;
  status: "creating" | "ready" | "error";
  createdAt: number;
  error?: string;
}

interface CollectionsState {
  data: StacCollection[];
  loading: boolean;
  error: string | null;
}

interface DataCatalogState {
  collections: CollectionsState;
  search: {
    filters: SearchFilters;
    results: SearchResults;
    visibleItems: string[]; // STAC item IDs currently displayed on map
    itemDetails: {
      item: StacItem | null;
      isOpen: boolean;
      currentIndex: number;
    };
  };
  activeTab: "collections" | "search";
  itemViewpoints: Record<string, ItemViewpointState>; // Track viewpoint state per STAC item
}

// Initial State
const initialState: DataCatalogState = {
  collections: {
    data: [],
    loading: false,
    error: null
  },
  search: {
    filters: {
      collections: [],
      bbox: null,
      useBboxFilter: false,
      dateRange: {
        start: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year ago
        end: new Date().toISOString() // today
      },
      query: "",
      limit: 50
    },
    results: {
      features: [],
      totalCount: 0,
      loading: false,
      error: null
    },
    visibleItems: [],
    itemDetails: {
      item: null,
      isOpen: false,
      currentIndex: 0
    }
  },
  activeTab: "collections",
  itemViewpoints: {}
};

// Async Thunks
export const fetchCollections = createAsyncThunk(
  "dataCatalog/fetchCollections",
  async () => {
    const collections = await dataCatalogService.getCollections();

    return collections;
  }
);

export const searchStacItems = createAsyncThunk(
  "dataCatalog/searchItems",
  async (_, { getState }) => {
    const state = getState() as RootState;
    const { filters } = state.dataCatalog.search;
    const viewport = state.viewport;

    // Build search parameters
    const searchParams: Record<string, unknown> = {
      limit: filters.limit
    };

    // Add collection filter if specified
    if (filters.collections.length > 0) {
      searchParams.collections = filters.collections;
    }

    // Add spatial filter if enabled
    if (filters.useBboxFilter && viewport) {
      searchParams.bbox = [
        viewport.extent.west,
        viewport.extent.south,
        viewport.extent.east,
        viewport.extent.north
      ];
    }

    // Add datetime filter if specified
    if (filters.dateRange.start && filters.dateRange.end) {
      // Convert to STAC datetime format: start/end
      const startDate = new Date(filters.dateRange.start).toISOString();
      const endDate = new Date(filters.dateRange.end).toISOString();

      searchParams.datetime = `${startDate}/${endDate}`;
    }

    // Add text search if specified
    if (filters.query.trim()) {
      // Use 'q' parameter as array for full-text search across item properties
      // Some STAC implementations expect q to be an array of search terms
      searchParams.q = [filters.query.trim()];
    }

    const response = await dataCatalogService.searchItems(searchParams);

    return response;
  }
);

// Create viewpoint for a STAC item
export const createViewpointForItem = createAsyncThunk(
  "dataCatalog/createViewpointForItem",
  async (item: StacItem, { rejectWithValue }) => {
    try {
      const viewpointRequest = getViewpointRequestFromStacItem(item);

      if (!viewpointRequest) {
        return rejectWithValue(
          "No suitable image asset found for viewpoint creation"
        );
      }

      const viewpoint =
        await viewpointService.createViewpoint(viewpointRequest);

      return {
        itemId: item.id,
        viewpointId: viewpoint.viewpoint_id,
        status: viewpoint.viewpoint_status
      };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to create viewpoint"
      );
    }
  }
);

// Poll viewpoint status until ready or error
export const pollViewpointStatus = createAsyncThunk(
  "dataCatalog/pollViewpointStatus",
  async (
    { itemId, viewpointId }: { itemId: string; viewpointId: string },
    { rejectWithValue }
  ) => {
    const maxAttempts = 24; // 24 attempts * 5 seconds = 2 minutes max
    const pollInterval = 5000; // 5 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const viewpoint = await viewpointService.getViewpoint(viewpointId);

        if (viewpoint.viewpoint_status === "READY") {
          return {
            itemId,
            viewpointId,
            status: "ready" as const
          };
        }

        if (viewpoint.viewpoint_status === "ERROR") {
          return rejectWithValue({
            itemId,
            error: viewpoint.error_message || "Viewpoint creation failed"
          });
        }

        // Still creating, wait before next poll
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }
      } catch (error) {
        return rejectWithValue({
          itemId,
          error:
            error instanceof Error
              ? error.message
              : "Failed to poll viewpoint status"
        });
      }
    }

    // Timeout after max attempts
    return rejectWithValue({
      itemId,
      error: "Viewpoint creation timeout - exceeded 2 minutes"
    });
  }
);

// Slice
export const dataCatalogSlice = createSlice({
  name: "dataCatalog",
  initialState,
  reducers: {
    setActiveTab: (state, action: PayloadAction<"collections" | "search">) => {
      state.activeTab = action.payload;
    },
    setViewpointStatus: (
      state,
      action: PayloadAction<{
        itemId: string;
        viewpointId: string;
        status: "creating" | "ready" | "error";
        error?: string;
      }>
    ) => {
      const { itemId, viewpointId, status, error } = action.payload;

      state.itemViewpoints[itemId] = {
        viewpointId,
        status,
        createdAt: Date.now(),
        error
      };
    },
    setSearchFilters: (
      state,
      action: PayloadAction<Partial<SearchFilters>>
    ) => {
      state.search.filters = { ...state.search.filters, ...action.payload };
    },
    toggleBboxFilter: (state) => {
      state.search.filters.useBboxFilter = !state.search.filters.useBboxFilter;
    },
    setCollectionFilter: (state, action: PayloadAction<string[]>) => {
      state.search.filters.collections = action.payload;
    },
    setQueryFilter: (state, action: PayloadAction<string>) => {
      state.search.filters.query = action.payload;
    },
    setDateRangeFilter: (
      state,
      action: PayloadAction<{ start: string | null; end: string | null }>
    ) => {
      state.search.filters.dateRange = action.payload;
    },
    toggleItemVisibility: (state, action: PayloadAction<string>) => {
      const itemId = action.payload;
      const index = state.search.visibleItems.indexOf(itemId);

      if (index > -1) {
        state.search.visibleItems.splice(index, 1);
      } else {
        state.search.visibleItems.push(itemId);
      }
    },
    clearVisibleItems: (state) => {
      state.search.visibleItems = [];
    },
    showItemDetails: (
      state,
      action: PayloadAction<{ item: StacItem; index: number }>
    ) => {
      state.search.itemDetails = {
        item: action.payload.item,
        isOpen: true,
        currentIndex: action.payload.index
      };
    },
    navigateToItem: (state, action: PayloadAction<number>) => {
      const index = action.payload;
      const item = state.search.results.features[index];

      if (item) {
        state.search.itemDetails = {
          item,
          isOpen: true,
          currentIndex: index
        };
      }
    },
    hideItemDetails: (state) => {
      state.search.itemDetails = {
        item: null,
        isOpen: false,
        currentIndex: 0
      };
    },
    clearSearchResults: (state) => {
      state.search.results = {
        features: [],
        totalCount: 0,
        loading: false,
        error: null
      };
      state.search.visibleItems = [];
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch Collections
      .addCase(fetchCollections.pending, (state) => {
        state.collections.loading = true;
        state.collections.error = null;
      })
      .addCase(fetchCollections.fulfilled, (state, action) => {
        state.collections.loading = false;
        state.collections.data = action.payload;
        state.collections.error = null;
      })
      .addCase(fetchCollections.rejected, (state, action) => {
        state.collections.loading = false;
        state.collections.error =
          action.error.message || "Failed to load collections";
      })
      // Search STAC Items
      .addCase(searchStacItems.pending, (state) => {
        state.search.results.loading = true;
        state.search.results.error = null;
      })
      .addCase(searchStacItems.fulfilled, (state, action) => {
        state.search.results.loading = false;
        state.search.results.features = action.payload.features;
        state.search.results.totalCount =
          action.payload.context?.matched ||
          action.payload.numMatched ||
          action.payload.features.length;
        state.search.results.error = null;
        // Clear previous visible items when new search is performed
        state.search.visibleItems = [];
      })
      // Create Viewpoint for Item
      .addCase(createViewpointForItem.pending, (state, action) => {
        const itemId = action.meta.arg.id;

        state.itemViewpoints[itemId] = {
          viewpointId: "", // Will be updated when fulfilled
          status: "creating",
          createdAt: Date.now()
        };
      })
      .addCase(createViewpointForItem.fulfilled, (state, action) => {
        if (typeof action.payload === "object" && "itemId" in action.payload) {
          const { itemId, viewpointId } = action.payload as {
            itemId: string;
            viewpointId: string;
          };

          state.itemViewpoints[itemId] = {
            viewpointId,
            status: "creating", // Will poll for status
            createdAt: Date.now()
          };
        }
      })
      .addCase(createViewpointForItem.rejected, (state, action) => {
        const itemId = action.meta.arg.id;

        state.itemViewpoints[itemId] = {
          viewpointId: "",
          status: "error",
          createdAt: Date.now(),
          error: action.payload as string
        };
      })
      // Poll Viewpoint Status
      .addCase(pollViewpointStatus.fulfilled, (state, action) => {
        if (typeof action.payload === "object" && "itemId" in action.payload) {
          const { itemId, viewpointId, status } = action.payload as {
            itemId: string;
            viewpointId: string;
            status: "ready";
          };

          state.itemViewpoints[itemId] = {
            viewpointId,
            status,
            createdAt: state.itemViewpoints[itemId]?.createdAt || Date.now()
          };
        }
      })
      .addCase(pollViewpointStatus.rejected, (state, action) => {
        if (
          action.payload &&
          typeof action.payload === "object" &&
          "itemId" in action.payload
        ) {
          const { itemId, error } = action.payload as {
            itemId: string;
            error: string;
          };

          if (state.itemViewpoints[itemId]) {
            state.itemViewpoints[itemId].status = "error";
            state.itemViewpoints[itemId].error = error;
          }
        }
      })
      .addCase(searchStacItems.rejected, (state, action) => {
        state.search.results.loading = false;
        state.search.results.error =
          action.error.message || "Failed to search items";
      });
  }
});

// Action Creators
export const {
  setActiveTab,
  setSearchFilters,
  toggleBboxFilter,
  setCollectionFilter,
  setQueryFilter,
  setDateRangeFilter,
  toggleItemVisibility,
  clearVisibleItems,
  showItemDetails,
  navigateToItem,
  hideItemDetails,
  clearSearchResults,
  setViewpointStatus
} = dataCatalogSlice.actions;

// Selectors
export const selectCollections = (state: RootState) =>
  state.dataCatalog.collections;
export const selectSearchFilters = (state: RootState) =>
  state.dataCatalog.search.filters;
export const selectSearchResults = (state: RootState) =>
  state.dataCatalog.search.results;
export const selectVisibleItems = (state: RootState) =>
  state.dataCatalog.search.visibleItems;
export const selectItemDetails = (state: RootState) =>
  state.dataCatalog.search.itemDetails;
export const selectActiveTab = (state: RootState) =>
  state.dataCatalog.activeTab;
export const selectItemViewpoints = (state: RootState) =>
  state.dataCatalog.itemViewpoints;
export const selectItemViewpoint = (itemId: string) => (state: RootState) =>
  state.dataCatalog.itemViewpoints[itemId];

export default dataCatalogSlice.reducer;
