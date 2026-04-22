// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for fetchGeoJSONData — routes detection data to
 * overlay-slice + GeoJSONCacheService.
 *
 * **Validates: Requirements 4.1–4.10, 10.1–10.5**
 */

/* ---------- mocks ---------- */

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
  DETECTION_MAX_POLL_DURATION,
  DETECTION_POLL_INTERVAL,
  fetchGeoJSONData
} from "@/store/slices/jobs-slice";
import {
  addLayer,
  removeLayer,
  updateLayerMetadata
} from "@/store/slices/overlay-slice";
import type { AppDispatch, RootState } from "@/store/store";

const mockedSearchItems = dataCatalogService.searchItems as jest.Mock;
const mockedDownloadFile = s3Service.downloadFile as jest.Mock;
const mockCache = GeoJSONCacheService.getInstance() as jest.Mocked<
  ReturnType<typeof GeoJSONCacheService.getInstance>
>;

function createMockBlob(data: Record<string, unknown>): Blob {
  const text = JSON.stringify(data);
  const blob = new Blob([text], { type: "application/json" });
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
  jobsList?: Record<string, unknown>;
}

function createMockState(
  job: ImageProcessingJob,
  overrides: MockStateOverrides = {}
) {
  return {
    jobs: {
      selection: { selectedJobs: [job], layerStyles: {}, ...overrides.jobs },
      jobsList: {
        jobs: [job],
        customOrder: [job.job_id],
        isLoading: false,
        isRefreshing: false,
        error: null,
        ...overrides.jobsList
      }
    },
    mapViewer: { viewpointData: {} },
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

describe("fetchGeoJSONData — overlay-slice routing", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("should dispatch addLayer with source detection and loading metadata", async () => {
    const job = createMockJob();
    mockedSearchItems.mockResolvedValue({
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
    await fetchGeoJSONData(job)(
      dispatch as unknown as AppDispatch,
      getState as unknown as () => RootState
    );
    const addLayerActions = dispatched.filter((a) => a.type === addLayer.type);
    expect(addLayerActions.length).toBeGreaterThanOrEqual(1);
    const addLayerPayload = addLayerActions[0].payload as OverlayActionPayload;
    expect(addLayerPayload.id).toBe(`detection-${job.job_id}`);
    expect(addLayerPayload.source).toBe("detection");
    expect(addLayerPayload.metadata?.loading).toBe(true);
  });

  it("should store FeatureCollection in GeoJSONCacheService on STAC success", async () => {
    const job = createMockJob();
    mockedSearchItems.mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          id: `${job.job_id}-image1`,
          assets: { source: { href: "s3://bucket/key.geojson" } }
        }
      ]
    });
    mockedDownloadFile.mockResolvedValue(
      createMockBlob({
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [1, 2] } }
        ]
      })
    );
    const { dispatch } = createDispatchAndCollector();
    await fetchGeoJSONData(job)(
      dispatch as unknown as AppDispatch,
      jest.fn(() => createMockState(job)) as unknown as () => RootState
    );
    expect(mockCache.set).toHaveBeenCalledWith(
      `detection-${job.job_id}`,
      expect.objectContaining({ type: "FeatureCollection" })
    );
  });

  it("should dispatch updateLayerMetadata with featureCount and loading false", async () => {
    const job = createMockJob();
    mockedSearchItems.mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          id: `${job.job_id}-image1`,
          assets: { source: { href: "s3://bucket/key.geojson" } }
        }
      ]
    });
    mockedDownloadFile.mockResolvedValue(
      createMockBlob({
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [1, 2] } },
          { type: "Feature", geometry: { type: "Point", coordinates: [3, 4] } }
        ]
      })
    );
    const { dispatch, dispatched } = createDispatchAndCollector();
    await fetchGeoJSONData(job)(
      dispatch as unknown as AppDispatch,
      jest.fn(() => createMockState(job)) as unknown as () => RootState
    );
    const successAction = dispatched
      .filter((a) => a.type === updateLayerMetadata.type)
      .find((a) => {
        const p = a.payload as OverlayActionPayload | undefined;
        return p?.metadata?.loading === false && !p?.metadata?.error;
      });
    expect(successAction).toBeDefined();
    expect((successAction!.payload as OverlayActionPayload).featureCount).toBe(
      2
    );
  });

  it("should NOT dispatch mapViewer geoJSON actions", async () => {
    const job = createMockJob();
    mockedSearchItems.mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          id: `${job.job_id}-image1`,
          assets: { source: { href: "s3://bucket/key.geojson" } }
        }
      ]
    });
    mockedDownloadFile.mockResolvedValue(
      createMockBlob({ type: "FeatureCollection", features: [] })
    );
    const { dispatch, dispatched } = createDispatchAndCollector();
    await fetchGeoJSONData(job)(
      dispatch as unknown as AppDispatch,
      jest.fn(() => createMockState(job)) as unknown as () => RootState
    );
    expect(
      dispatched.filter(
        (a) =>
          a.type?.includes("mapViewer/setGeoJSONData") ||
          a.type?.includes("mapViewer/setGeoJSONError")
      )
    ).toHaveLength(0);
  });

  it("should dispatch updateLayerMetadata with error on STAC failure", async () => {
    const job = createMockJob();
    mockedSearchItems.mockRejectedValue(new Error("STAC catalog unreachable"));
    const { dispatch, dispatched } = createDispatchAndCollector();
    await fetchGeoJSONData(job)(
      dispatch as unknown as AppDispatch,
      jest.fn(() => createMockState(job)) as unknown as () => RootState
    );
    const errorAction = dispatched
      .filter((a) => a.type === updateLayerMetadata.type)
      .find(
        (a) => (a.payload as OverlayActionPayload | undefined)?.metadata?.error
      );
    expect(errorAction).toBeDefined();
    expect(
      (errorAction!.payload as OverlayActionPayload).metadata!.error
    ).toContain("STAC catalog unreachable");
  });

  it("should dispatch timeout error after max duration", async () => {
    const job = createMockJob();
    mockedSearchItems.mockResolvedValue({
      type: "FeatureCollection",
      features: []
    });
    const { dispatch, dispatched } = createDispatchAndCollector();
    const p = fetchGeoJSONData(job)(
      dispatch as unknown as AppDispatch,
      jest.fn(() => createMockState(job)) as unknown as () => RootState
    );
    for (
      let i = 0;
      i < Math.ceil(DETECTION_MAX_POLL_DURATION / DETECTION_POLL_INTERVAL) + 2;
      i++
    ) {
      await jest.advanceTimersByTimeAsync(DETECTION_POLL_INTERVAL);
    }
    await p;
    const timeoutAction = dispatched
      .filter((a) => a.type === updateLayerMetadata.type)
      .find(
        (a) => (a.payload as OverlayActionPayload | undefined)?.metadata?.error
      );
    expect(timeoutAction).toBeDefined();
    expect(
      (timeoutAction!.payload as OverlayActionPayload).metadata!.error
    ).toContain("may still be processing");
  });

  it("should exit silently when job is deselected during poll (middleware owns cleanup)", async () => {
    const job = createMockJob();
    // searchItems keeps returning no matching features so the thunk stays
    // in its polling loop.
    mockedSearchItems.mockResolvedValue({
      type: "FeatureCollection",
      features: []
    });
    // The selection is empty from the start — when the poll loop does its
    // "still selected?" check after the first interval, it will exit.
    const getState = jest.fn(() =>
      createMockState(job, { jobs: { selectedJobs: [] } })
    );
    const { dispatch, dispatched } = createDispatchAndCollector();
    const p = fetchGeoJSONData(job)(
      dispatch as unknown as AppDispatch,
      getState as unknown as () => RootState
    );
    // Advance past the first poll interval so the selection check fires.
    await jest.advanceTimersByTimeAsync(DETECTION_POLL_INTERVAL);
    await p;

    // Under the current architecture the thunk does NOT dispatch removeLayer
    // or clear the cache itself when the job leaves the selection — the
    // jobs-slice middleware owns that path. The thunk simply stops polling.
    expect(dispatched.filter((a) => a.type === removeLayer.type).length).toBe(
      0
    );
    expect(mockCache.delete).not.toHaveBeenCalled();

    // Initial searchItems + addLayer still happened (the thunk runs its
    // first STAC query before checking selection).
    expect(mockedSearchItems).toHaveBeenCalled();
  });

  it("should skip re-fetch when data is already in the cache", async () => {
    const job = createMockJob();
    const layerId = `detection-${job.job_id}`;

    // Configure the cache mock to report a cached entry
    mockCache.has.mockReturnValueOnce(true);
    mockCache.get.mockReturnValueOnce({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: {}
        }
      ]
    });

    const { dispatch, dispatched } = createDispatchAndCollector();
    const getState = jest.fn(() =>
      createMockState(job, {
        overlay: {
          layers: {},
          layerOrder: [],
          inlineFeatures: {}
        }
      })
    );
    await fetchGeoJSONData(job)(
      dispatch as unknown as AppDispatch,
      getState as unknown as () => RootState
    );
    expect(mockedSearchItems).not.toHaveBeenCalled();

    // Still registers the overlay layer from the cached data, in a loaded
    // (non-loading) state.
    const addLayerActions = dispatched.filter((a) => a.type === addLayer.type);
    expect(addLayerActions.length).toBe(1);
    const payload = addLayerActions[0].payload as OverlayActionPayload;
    expect(payload.id).toBe(layerId);
    expect(payload.metadata?.loading).toBe(false);
  });

  it("should complete the initial fetch even if the job is not in the selection (middleware gates entry)", async () => {
    const job = createMockJob();
    mockedSearchItems.mockResolvedValue({
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
    await fetchGeoJSONData(job)(
      dispatch as unknown as AppDispatch,
      jest.fn(() =>
        createMockState(job, { jobs: { selectedJobs: [] } })
      ) as unknown as () => RootState
    );
    // The selection check only fires during the polling loop; when STAC
    // returns results on the first call the thunk completes and writes to
    // the cache + dispatches addLayer, even if selection was empty.
    expect(
      dispatched.filter((a) => a.type === addLayer.type).length
    ).toBeGreaterThanOrEqual(1);
    expect(mockCache.set).toHaveBeenCalled();
  });
});

describe("Sidebar catalog status from overlay state", () => {
  interface MockLayer {
    metadata?: { loading?: boolean; error?: string };
    featureCount?: number;
  }

  function deriveIsCataloging(
    layers: Record<string, MockLayer>,
    jobId: string,
    status: string
  ) {
    if (status !== "SUCCESS") return false;
    const l = layers[`detection-${jobId}`];
    return !l || l.metadata?.loading === true;
  }
  function deriveHasCatalogError(
    layers: Record<string, MockLayer>,
    jobId: string,
    status: string
  ) {
    if (status !== "SUCCESS") return false;
    const l = layers[`detection-${jobId}`];
    return l ? !!l.metadata?.error : false;
  }
  function deriveIsDisabled(
    layers: Record<string, MockLayer>,
    jobId: string,
    status: string
  ) {
    if (status !== "SUCCESS") return true;
    const l = layers[`detection-${jobId}`];
    return !l || !!l.metadata?.loading;
  }

  it("should derive isCataloging from overlay layer metadata.loading", () => {
    const id = "job-123";
    const layers = { [`detection-${id}`]: { metadata: { loading: true } } };
    expect(deriveIsCataloging(layers, id, "SUCCESS")).toBe(true);
    layers[`detection-${id}`].metadata.loading = false;
    expect(deriveIsCataloging(layers, id, "SUCCESS")).toBe(false);
  });

  it("should derive hasCatalogError from overlay layer metadata.error", () => {
    const id = "job-456";
    const layers: Record<string, MockLayer> = {
      [`detection-${id}`]: { metadata: { loading: false, error: "err" } }
    };
    expect(deriveHasCatalogError(layers, id, "SUCCESS")).toBe(true);
    layers[`detection-${id}`].metadata = { loading: false };
    expect(deriveHasCatalogError(layers, id, "SUCCESS")).toBe(false);
  });

  it("should disable job while detection layer loading", () => {
    const id = "job-789";
    const layers = { [`detection-${id}`]: { metadata: { loading: true } } };
    expect(deriveIsDisabled(layers, id, "SUCCESS")).toBe(true);
    layers[`detection-${id}`].metadata.loading = false;
    expect(deriveIsDisabled(layers, id, "SUCCESS")).toBe(false);
  });

  it("should show catalog error when metadata.error set", () => {
    const id = "job-err";
    const layers = {
      [`detection-${id}`]: { metadata: { loading: false, error: "err" } }
    };
    expect(deriveHasCatalogError(layers, id, "SUCCESS")).toBe(true);
    expect(deriveHasCatalogError(layers, id, "RUNNING")).toBe(false);
  });

  it("should enable job when loading false and no error", () => {
    const id = "job-ok";
    const layers = {
      [`detection-${id}`]: { featureCount: 42, metadata: { loading: false } }
    };
    expect(deriveIsDisabled(layers, id, "SUCCESS")).toBe(false);
    expect(deriveIsCataloging(layers, id, "SUCCESS")).toBe(false);
    expect(deriveHasCatalogError(layers, id, "SUCCESS")).toBe(false);
  });
});
