// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for viewpoint-service.ts.
 * Covers viewpoint CRUD, bounds/metadata/info/statistics retrieval,
 * and WGS84 extent extraction.
 */

import { viewpointService } from "@/services/viewpoint-service";
import { tileServerApiClient } from "@/utils/api-client";

jest.mock("@/utils/api-client", () => ({
  tileServerApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn()
  }
}));

const mockGet = tileServerApiClient.get as jest.Mock;
const mockPost = tileServerApiClient.post as jest.Mock;
const mockDelete = tileServerApiClient.delete as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe("ViewpointService", () => {
  describe("getViewpoints", () => {
    it("should return items array from response", async () => {
      mockGet.mockResolvedValue({
        items: [{ viewpoint_id: "vp-1" }, { viewpoint_id: "vp-2" }],
        next_token: ""
      });

      const viewpoints = await viewpointService.getViewpoints();
      expect(viewpoints).toHaveLength(2);
      expect(mockGet).toHaveBeenCalledWith("/latest/viewpoints");
    });
  });

  describe("getViewpoint", () => {
    it("should fetch a single viewpoint by ID", async () => {
      mockGet.mockResolvedValue({
        viewpoint_id: "vp-1",
        viewpoint_status: "READY"
      });
      const vp = await viewpointService.getViewpoint("vp-1");
      expect(mockGet).toHaveBeenCalledWith("/latest/viewpoints/vp-1");
      expect(vp.viewpoint_status).toBe("READY");
    });
  });

  describe("createViewpoint", () => {
    it("should POST viewpoint data and return result", async () => {
      const request = {
        viewpoint_name: "Test",
        viewpoint_id: "vp-1",
        bucket_name: "bucket",
        object_key: "key.tif",
        tile_size: 256,
        range_adjustment: "DRA" as const
      };
      mockPost.mockResolvedValue({
        viewpoint_id: "vp-1",
        viewpoint_status: "CREATING"
      });

      const result = await viewpointService.createViewpoint(request);
      expect(mockPost).toHaveBeenCalledWith("/latest/viewpoints", request);
      expect(result.viewpoint_id).toBe("vp-1");
    });
  });

  describe("getViewpointBounds", () => {
    it("should fetch bounds for viewpoint", async () => {
      mockGet.mockResolvedValue({ bounds: [-122, 37, -121, 38] });
      const bounds = await viewpointService.getViewpointBounds("vp-1");
      expect(mockGet).toHaveBeenCalledWith(
        "/latest/viewpoints/vp-1/image/bounds"
      );
      expect(bounds.bounds).toEqual([-122, 37, -121, 38]);
    });
  });

  describe("getViewpointMetadata", () => {
    it("should fetch metadata for viewpoint", async () => {
      mockGet.mockResolvedValue({ metadata: { crs: "EPSG:4326" } });
      const meta = await viewpointService.getViewpointMetadata("vp-1");
      expect(mockGet).toHaveBeenCalledWith(
        "/latest/viewpoints/vp-1/image/metadata"
      );
      expect(meta.metadata).toEqual({ crs: "EPSG:4326" });
    });
  });

  describe("getViewpointInfo", () => {
    it("should fetch info for viewpoint", async () => {
      mockGet.mockResolvedValue({ type: "FeatureCollection", features: [] });
      const info = await viewpointService.getViewpointInfo("vp-1");
      expect(mockGet).toHaveBeenCalledWith(
        "/latest/viewpoints/vp-1/image/info"
      );
      expect(info.type).toBe("FeatureCollection");
    });
  });

  describe("getViewpointStatistics", () => {
    it("should fetch statistics for viewpoint", async () => {
      mockGet.mockResolvedValue({ image_statistics: { bands: 3 } });
      const stats = await viewpointService.getViewpointStatistics("vp-1");
      expect(mockGet).toHaveBeenCalledWith(
        "/latest/viewpoints/vp-1/image/statistics"
      );
      expect(stats.image_statistics).toEqual({ bands: 3 });
    });
  });

  describe("getViewpointExtentWGS84", () => {
    it("should extract min/max lon/lat from polygon coordinates", async () => {
      mockGet.mockResolvedValue({
        image_statistics: {
          wgs84Extent: {
            coordinates: [
              [
                [-122.5, 37.0],
                [-121.5, 37.0],
                [-121.5, 38.0],
                [-122.5, 38.0],
                [-122.5, 37.0]
              ]
            ]
          }
        }
      });

      const extent = await viewpointService.getViewpointExtentWGS84("vp-1");
      expect(extent).toEqual({
        minLon: -122.5,
        minLat: 37.0,
        maxLon: -121.5,
        maxLat: 38.0
      });
    });

    it("should return undefined when statistics lack wgs84Extent", async () => {
      mockGet.mockResolvedValue({ image_statistics: {} });
      const extent = await viewpointService.getViewpointExtentWGS84("vp-1");
      expect(extent).toBeUndefined();
    });

    it("should return undefined when coordinates are missing", async () => {
      mockGet.mockResolvedValue({
        image_statistics: { wgs84Extent: {} }
      });
      const extent = await viewpointService.getViewpointExtentWGS84("vp-1");
      expect(extent).toBeUndefined();
    });

    it("should return undefined on API error", async () => {
      mockGet.mockRejectedValue(new Error("fail"));
      const extent = await viewpointService.getViewpointExtentWGS84("vp-1");
      expect(extent).toBeUndefined();
    });
  });

  describe("deleteViewpoint", () => {
    it("should call DELETE endpoint", async () => {
      mockDelete.mockResolvedValue({ viewpoint_id: "vp-1" });
      const result = await viewpointService.deleteViewpoint("vp-1");
      expect(mockDelete).toHaveBeenCalledWith("/latest/viewpoints/vp-1");
      expect(result.viewpoint_id).toBe("vp-1");
    });
  });
});
