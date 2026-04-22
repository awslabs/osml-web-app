// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for STAC-based fetchGeoJSONData
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4**
 *
 * Updated for overlay-slice routing: fetchGeoJSONData now dispatches to
 * overlay-slice + GeoJSONCacheService instead of mapViewer.map.geoJSONData.
 */

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: {
    searchItems: jest.fn()
  }
}));

jest.mock("@/services/s3-service", () => ({
  s3Service: {
    downloadFile: jest.fn()
  }
}));

jest.mock("@/services/geojson-cache-service", () => {
  const mockCache = {
    set: jest.fn(),
    get: jest.fn().mockReturnValue(null),
    has: jest.fn().mockReturnValue(false),
    delete: jest.fn(),
    clear: jest.fn(),
    getFeatureCount: jest.fn().mockReturnValue(0),
    getStats: jest.fn().mockReturnValue({ entryCount: 0, totalByteSize: 0 }),
    subscribe: jest.fn().mockReturnValue(jest.fn()),
    getVersion: jest.fn().mockReturnValue(0)
  };
  return {
    GeoJSONCacheService: {
      getInstance: jest.fn(() => mockCache),
      resetInstance: jest.fn()
    }
  };
});

import { dataCatalogService } from "@/services/data-catalog-service";
import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import { ImageProcessingJob } from "@/services/model-runner-service";
import { s3Service } from "@/services/s3-service";
import {
  DETECTION_COLLECTION,
  DETECTION_MAX_POLL_DURATION,
  DETECTION_POLL_INTERVAL,
  fetchGeoJSONData
} from "@/store/slices/jobs-slice";
import { addLayer, updateLayerMetadata } from "@/store/slices/overlay-slice";
import type { AppDispatch, RootState } from "@/store/store";

const mockedSearchItems = dataCatalogService.searchItems as jest.Mock;
const mockedDownloadFile = s3Service.downloadFile as jest.Mock;
const mockCache = GeoJSONCacheService.getInstance() as jest.Mocked<
  ReturnType<typeof GeoJSONCacheService.getInstance>
>;

function createMockBlob(data: Record<string, unknown>): Blob {
  const text = JSON.stringify(data);
  const blob = new Blob([text], { type: "application/json" });
  // jsdom Blob doesn't support .text(), so add it
  if (!blob.text) {
    Object.defineProperty(blob, "text", {
      value: () => Promise.resolve(text)
    });
  }
  return blob;
}

function createMockJob(jobId: string = "test-job-abc"): ImageProcessingJob {
  return {
    job_id: jobId,
    status: "SUCCESS",
    updated_at: new Date().toISOString()
  };
}

interface MockStateOverrides {
  jobs?: Record<string, unknown>;
  overlay?: Record<string, unknown>;
}

function createMockState(
  job: ImageProcessingJob,
  overrides: MockStateOverrides = {}
) {
  return {
    jobs: {
      selection: {
        selectedJobs: [job],
        layerStyles: {},
        ...overrides.jobs
      },
      jobsList: {
        jobs: [job],
        customOrder: [job.job_id],
        isLoading: false,
        isRefreshing: false,
        error: null
      }
    },
    mapViewer: {
      viewpointData: {}
    },
    overlay: {
      layers: {},
      layerOrder: [],
      inlineFeatures: {},
      ...overrides.overlay
    }
  };
}

function createDispatchAndCollector() {
  const dispatched: Array<{ type: string; payload?: Record<string, unknown> }> =
    [];
  const dispatch = jest.fn(
    (action: { type: string; payload?: Record<string, unknown> }) => {
      dispatched.push(action);
    }
  );
  return { dispatch, dispatched };
}

/** Helper type for dispatched overlay actions with metadata payload. */
interface OverlayActionPayload {
  id?: string;
  source?: string;
  metadata?: { loading?: boolean; error?: string; jobId?: string };
  featureCount?: number;
  layerId?: string;
  [key: string]: unknown;
}

describe("Map Viewer Slice - STAC-based fetchGeoJSONData", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Test: fetchGeoJSONData calls dataCatalogService.searchItems instead of s3Service.downloadFile
   * **Validates: Requirements 5.1, 5.4**
   */
  describe("STAC catalog query", () => {
    it("should call dataCatalogService.searchItems with detection collection", async () => {
      const job = createMockJob();
      const geojsonData = { type: "FeatureCollection", features: [] };

      mockedSearchItems.mockResolvedValue({
        type: "FeatureCollection",
        features: [
          {
            id: `${job.job_id}-image1`,
            assets: {
              source: { href: "s3://my-bucket/path/to/file.geojson" }
            }
          }
        ]
      });

      mockedDownloadFile.mockResolvedValue(createMockBlob(geojsonData));

      const { dispatch } = createDispatchAndCollector();
      const getState = jest.fn(() => createMockState(job));

      const thunkFn = fetchGeoJSONData(job);
      await thunkFn(
        dispatch as unknown as AppDispatch,
        getState as unknown as () => RootState
      );

      // Verify dataCatalogService.searchItems was called
      expect(mockedSearchItems).toHaveBeenCalledWith(
        expect.objectContaining({
          collections: [DETECTION_COLLECTION],
          limit: 100
        })
      );
    });

    it("should filter features by job_id prefix", async () => {
      const job = createMockJob("my-job-id");
      const geojsonData = { type: "FeatureCollection", features: [] };

      mockedSearchItems.mockResolvedValue({
        type: "FeatureCollection",
        features: [
          {
            id: "my-job-id-image1",
            assets: {
              source: { href: "s3://bucket/key.geojson" }
            }
          },
          {
            id: "other-job-image2",
            assets: {
              source: { href: "s3://bucket/other.geojson" }
            }
          }
        ]
      });

      mockedDownloadFile.mockResolvedValue(createMockBlob(geojsonData));

      const { dispatch } = createDispatchAndCollector();
      const getState = jest.fn(() => createMockState(job));

      const thunkFn = fetchGeoJSONData(job);
      await thunkFn(
        dispatch as unknown as AppDispatch,
        getState as unknown as () => RootState
      );

      // Should download from the matching feature's asset, not the other one
      expect(mockedDownloadFile).toHaveBeenCalledWith("bucket", "key.geojson");
    });

    it("should download GeoJSON from STAC item source asset via s3Service", async () => {
      const job = createMockJob();
      const geojsonData = {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] } }
        ]
      };

      mockedSearchItems.mockResolvedValue({
        type: "FeatureCollection",
        features: [
          {
            id: `${job.job_id}-image1`,
            assets: {
              source: { href: "s3://detection-bucket/results/output.geojson" }
            }
          }
        ]
      });

      mockedDownloadFile.mockResolvedValue(createMockBlob(geojsonData));

      const { dispatch, dispatched } = createDispatchAndCollector();
      const getState = jest.fn(() => createMockState(job));

      const thunkFn = fetchGeoJSONData(job);
      await thunkFn(
        dispatch as unknown as AppDispatch,
        getState as unknown as () => RootState
      );

      // Verify s3Service.downloadFile was called with extracted bucket and key
      expect(mockedDownloadFile).toHaveBeenCalledWith(
        "detection-bucket",
        "results/output.geojson"
      );

      // Verify data was stored in cache
      expect(mockCache.set).toHaveBeenCalledWith(
        `detection-${job.job_id}`,
        expect.objectContaining({ type: "FeatureCollection" })
      );

      // Verify updateLayerMetadata was dispatched with loading: false
      const metadataActions = dispatched.filter(
        (a) => a.type === updateLayerMetadata.type
      );
      const successAction = metadataActions.find((a) => {
        const p = a.payload as OverlayActionPayload | undefined;
        return p?.metadata?.loading === false && !p?.metadata?.error;
      });
      expect(successAction).toBeDefined();
      expect(
        (successAction!.payload as OverlayActionPayload).featureCount
      ).toBe(1);
    });

    it("should use feature geometry directly when no source asset href exists", async () => {
      const job = createMockJob();

      const matchingFeature = {
        id: `${job.job_id}-image1`,
        type: "Feature",
        geometry: { type: "Point", coordinates: [1, 2] },
        assets: {}
      };

      mockedSearchItems.mockResolvedValue({
        type: "FeatureCollection",
        features: [matchingFeature]
      });

      const { dispatch } = createDispatchAndCollector();
      const getState = jest.fn(() => createMockState(job));

      const thunkFn = fetchGeoJSONData(job);
      await thunkFn(
        dispatch as unknown as AppDispatch,
        getState as unknown as () => RootState
      );

      // Should NOT call s3Service.downloadFile
      expect(mockedDownloadFile).not.toHaveBeenCalled();

      // Should store FeatureCollection in cache built from matching features
      expect(mockCache.set).toHaveBeenCalledWith(
        `detection-${job.job_id}`,
        expect.objectContaining({
          type: "FeatureCollection",
          features: [matchingFeature]
        })
      );
    });
  });

  /**
   * Test: Polling starts when STAC returns no items
   * **Validates: Requirements 5.3, 6.1**
   */
  describe("Polling behavior", () => {
    it("should start polling when STAC returns no matching items", async () => {
      const job = createMockJob();

      // First call: no items. Second call: items available.
      mockedSearchItems
        .mockResolvedValueOnce({
          type: "FeatureCollection",
          features: []
        })
        .mockResolvedValueOnce({
          type: "FeatureCollection",
          features: [
            {
              id: `${job.job_id}-image1`,
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              assets: {}
            }
          ]
        });

      const { dispatch } = createDispatchAndCollector();
      const getState = jest.fn(() => createMockState(job));

      const thunkFn = fetchGeoJSONData(job);
      const thunkPromise = thunkFn(
        dispatch as unknown as AppDispatch,
        getState as unknown as () => RootState
      );

      // Advance past the first poll interval
      await jest.advanceTimersByTimeAsync(DETECTION_POLL_INTERVAL);
      await thunkPromise;

      // searchItems should have been called at least twice (initial + retry)
      expect(mockedSearchItems.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    /**
     * Test: Polling stops when items become available
     * **Validates: Requirements 5.2, 6.3**
     */
    it("should stop polling when items become available", async () => {
      const job = createMockJob();

      // First two calls: no items. Third call: items available.
      mockedSearchItems
        .mockResolvedValueOnce({ type: "FeatureCollection", features: [] })
        .mockResolvedValueOnce({ type: "FeatureCollection", features: [] })
        .mockResolvedValueOnce({
          type: "FeatureCollection",
          features: [
            {
              id: `${job.job_id}-image1`,
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              assets: {}
            }
          ]
        });

      const { dispatch, dispatched } = createDispatchAndCollector();
      const getState = jest.fn(() => createMockState(job));

      const thunkFn = fetchGeoJSONData(job);
      const thunkPromise = thunkFn(
        dispatch as unknown as AppDispatch,
        getState as unknown as () => RootState
      );

      // Advance through two poll intervals
      await jest.advanceTimersByTimeAsync(DETECTION_POLL_INTERVAL);
      await jest.advanceTimersByTimeAsync(DETECTION_POLL_INTERVAL);
      await thunkPromise;

      // Verify data was stored in cache successfully
      expect(mockCache.set).toHaveBeenCalledWith(
        `detection-${job.job_id}`,
        expect.objectContaining({ type: "FeatureCollection" })
      );

      // Verify updateLayerMetadata with loading: false was dispatched
      const metadataActions = dispatched.filter(
        (a) => a.type === updateLayerMetadata.type
      );
      const successAction = metadataActions.find((a) => {
        const p = a.payload as OverlayActionPayload | undefined;
        return p?.metadata?.loading === false && !p?.metadata?.error;
      });
      expect(successAction).toBeDefined();

      // No error should have been dispatched
      const errorActions = dispatched.filter(
        (a) =>
          a.type === updateLayerMetadata.type &&
          (a.payload as OverlayActionPayload | undefined)?.metadata?.error
      );
      expect(errorActions.length).toBe(0);
    });

    /**
     * Test: Polling stops after max duration with informational message
     * **Validates: Requirements 6.4**
     */
    it("should stop polling after max duration and dispatch informational message", async () => {
      const job = createMockJob();

      // Always return no items
      mockedSearchItems.mockResolvedValue({
        type: "FeatureCollection",
        features: []
      });

      const { dispatch, dispatched } = createDispatchAndCollector();
      const getState = jest.fn(() => createMockState(job));

      const thunkFn = fetchGeoJSONData(job);
      const thunkPromise = thunkFn(
        dispatch as unknown as AppDispatch,
        getState as unknown as () => RootState
      );

      // Advance through the entire max poll duration plus extra
      const maxCycles =
        Math.ceil(DETECTION_MAX_POLL_DURATION / DETECTION_POLL_INTERVAL) + 2;
      for (let i = 0; i < maxCycles; i++) {
        await jest.advanceTimersByTimeAsync(DETECTION_POLL_INTERVAL);
      }

      await thunkPromise;

      // Verify timeout error was dispatched via updateLayerMetadata
      const metadataActions = dispatched.filter(
        (a) => a.type === updateLayerMetadata.type
      );
      const timeoutAction = metadataActions.find(
        (a) => (a.payload as OverlayActionPayload | undefined)?.metadata?.error
      );
      expect(timeoutAction).toBeDefined();
      expect(
        (timeoutAction!.payload as OverlayActionPayload).metadata!.error
      ).toContain("may still be processing");
    });
  });

  /**
   * Test: Loading state is set during polling
   * **Validates: Requirements 6.2**
   */
  describe("Loading state", () => {
    it("should set loading state initially and during polling", async () => {
      const job = createMockJob();

      // Return no items first, then items on second call
      mockedSearchItems
        .mockResolvedValueOnce({ type: "FeatureCollection", features: [] })
        .mockResolvedValueOnce({
          type: "FeatureCollection",
          features: [
            {
              id: `${job.job_id}-image1`,
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              assets: {}
            }
          ]
        });

      const { dispatch, dispatched } = createDispatchAndCollector();
      const getState = jest.fn(() => createMockState(job));

      const thunkFn = fetchGeoJSONData(job);
      const thunkPromise = thunkFn(
        dispatch as unknown as AppDispatch,
        getState as unknown as () => RootState
      );

      await jest.advanceTimersByTimeAsync(DETECTION_POLL_INTERVAL);
      await thunkPromise;

      // Verify addLayer was dispatched with loading: true metadata
      const addLayerActions = dispatched.filter(
        (a) =>
          a.type === addLayer.type &&
          (a.payload as OverlayActionPayload | undefined)?.metadata?.loading ===
            true
      );
      expect(addLayerActions.length).toBeGreaterThanOrEqual(1);
    });
  });

  /**
   * Test: Skip if already loaded
   */
  describe("Caching", () => {
    it("should skip fetching if data is already in the cache", async () => {
      const job = createMockJob();
      const layerId = `detection-${job.job_id}`;

      // Configure the mock cache to report a cached entry for this layer
      mockCache.has.mockReturnValueOnce(true);
      mockCache.get.mockReturnValueOnce({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: {}
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: {}
          }
        ]
      });

      const { dispatch } = createDispatchAndCollector();
      const getState = jest.fn(() =>
        createMockState(job, {
          overlay: {
            layers: {},
            layerOrder: [],
            inlineFeatures: {}
          }
        })
      );

      const thunkFn = fetchGeoJSONData(job);
      await thunkFn(
        dispatch as unknown as AppDispatch,
        getState as unknown as () => RootState
      );

      // Should not call searchItems since cached data is available
      expect(mockedSearchItems).not.toHaveBeenCalled();

      // Should register the overlay layer directly from the cache, without
      // a loading state (addLayer with loading: false).
      const addLayerCalls = dispatch.mock.calls.filter(
        (call) =>
          typeof call[0] === "object" &&
          call[0] !== null &&
          (call[0] as { type?: string }).type === addLayer.type
      );
      expect(addLayerCalls.length).toBeGreaterThanOrEqual(1);
      const addLayerPayload = (addLayerCalls[0][0] as { payload: unknown })
        .payload as {
        id: string;
        featureCount: number;
        metadata: { loading: boolean };
      };
      expect(addLayerPayload.id).toBe(layerId);
      expect(addLayerPayload.featureCount).toBe(2);
      expect(addLayerPayload.metadata.loading).toBe(false);
    });
  });
});
