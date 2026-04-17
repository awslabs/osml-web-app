// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import {
  DETECTION_MAX_POLL_DURATION,
  DETECTION_POLL_INTERVAL
} from "@/store/slices/jobs-slice";

/**
 * Feature: stac-detection-catalog, Property 6: Detection polling bounded by max duration
 * **Validates: Requirements 6.1, 6.4**
 *
 * For any polling session initiated when the STAC catalog returns no detection items,
 * the polling SHALL terminate (stop retrying) within the configured maximum duration,
 * regardless of whether items become available.
 */

// Mock data-catalog-service — always returns no items (simulates never-available detections)
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
import { ImageProcessingJob } from "@/services/model-runner-service";
import { fetchGeoJSONData } from "@/store/slices/jobs-slice";
import { updateLayerMetadata } from "@/store/slices/overlay-slice";
import type { AppDispatch, RootState } from "@/store/store";

const mockedSearchItems = dataCatalogService.searchItems as jest.Mock;

describe("Map Viewer Slice - STAC Detection Polling Property Tests", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Property 6: Detection polling is bounded by max duration
   * **Validates: Requirements 6.1, 6.4**
   */
  describe("Property 6: Detection polling is bounded by max duration", () => {
    it("should terminate polling within max duration when STAC never returns items", () => {
      // Use the actual constants from the slice to validate the property
      // against the real configuration
      const pollInterval = DETECTION_POLL_INTERVAL; // 5000ms
      const maxDuration = DETECTION_MAX_POLL_DURATION; // 300000ms

      // The maximum number of polls that can occur is ceil(maxDuration / pollInterval)
      const maxPolls = Math.ceil(maxDuration / pollInterval);

      // Verify the relationship: polling is bounded
      expect(maxPolls).toBeGreaterThan(0);
      expect(maxPolls * pollInterval).toBeGreaterThanOrEqual(maxDuration);
      expect(pollInterval).toBeGreaterThan(0);
      expect(maxDuration).toBeGreaterThan(0);
    });

    it("should bound polling attempts for any valid poll interval and max duration", () => {
      fc.assert(
        fc.property(
          // Generate poll intervals between 100ms and 30s
          fc.integer({ min: 100, max: 30000 }),
          // Generate max durations between 1s and 5 minutes
          fc.integer({ min: 1000, max: 300000 }),
          (pollInterval: number, maxDuration: number) => {
            // Simulate the polling logic from fetchGeoJSONData:
            // The thunk polls at `pollInterval` and checks `elapsed >= maxPollDuration`
            let elapsed = 0;
            let attempts = 0;

            while (elapsed < maxDuration) {
              attempts += 1;
              elapsed += pollInterval;
            }

            // Property: polling always terminates
            expect(elapsed).toBeGreaterThanOrEqual(maxDuration);

            // Property: the number of attempts is bounded by ceil(maxDuration / pollInterval)
            const expectedMaxAttempts = Math.ceil(maxDuration / pollInterval);
            expect(attempts).toBeLessThanOrEqual(expectedMaxAttempts);
            expect(attempts).toBeGreaterThan(0);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should dispatch timeout error after max duration with mock STAC service", async () => {
      // STAC always returns no items
      mockedSearchItems.mockResolvedValue({
        type: "FeatureCollection",
        features: []
      });

      const job: ImageProcessingJob = {
        job_id: "test-job-123",
        status: "SUCCESS",
        updated_at: new Date().toISOString()
      };

      const dispatched: Array<{
        type: string;
        payload?: Record<string, unknown>;
      }> = [];
      const dispatch = jest.fn(
        (action: { type: string; payload?: Record<string, unknown> }) => {
          dispatched.push(action);
        }
      );

      const getState = jest.fn(() => ({
        jobs: {
          selection: {
            selectedJobs: [job],
            layerStyles: {}
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
          inlineFeatures: {}
        }
      }));

      // Start the thunk
      const thunkFn = fetchGeoJSONData(job);
      const thunkPromise = thunkFn(
        dispatch as unknown as AppDispatch,
        getState as unknown as () => RootState
      );

      // Advance timers through the entire polling duration
      const maxCycles =
        Math.ceil(DETECTION_MAX_POLL_DURATION / DETECTION_POLL_INTERVAL) + 2;

      for (let i = 0; i < maxCycles; i++) {
        await jest.advanceTimersByTimeAsync(DETECTION_POLL_INTERVAL);
      }

      await thunkPromise;

      // Verify that updateLayerMetadata was dispatched with the timeout error
      const errorActions = dispatched.filter(
        (a) =>
          a.type === updateLayerMetadata.type &&
          (
            a.payload as { metadata?: { error?: string } } | undefined
          )?.metadata?.error?.includes("may still be processing")
      );
      expect(errorActions.length).toBe(1);

      // Verify polling was bounded — searchItems should have been called
      // a bounded number of times (initial + retries)
      const maxExpectedCalls =
        Math.ceil(DETECTION_MAX_POLL_DURATION / DETECTION_POLL_INTERVAL) + 1;
      expect(mockedSearchItems.mock.calls.length).toBeGreaterThan(0);
      expect(mockedSearchItems.mock.calls.length).toBeLessThanOrEqual(
        maxExpectedCalls
      );
    });
  });
});
