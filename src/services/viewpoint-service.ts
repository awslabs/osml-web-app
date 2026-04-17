// Copyright Amazon.com, Inc. or its affiliates.
import {
  CreateViewpointRequest,
  Viewpoint,
  ViewpointBounds,
  ViewpointExtent,
  ViewpointInfo,
  ViewpointMetadata,
  ViewpointStatistics
} from "@/store/types.ts";

import { tileServerApiClient } from "../utils/api-client";

export interface GetViewpointsResponse {
  items: Viewpoint[];
  next_token: string;
}

class ViewpointService {
  private retryCount: number = 3;

  async getViewpoints(): Promise<Viewpoint[]> {
    const data: GetViewpointsResponse =
      await tileServerApiClient.get("/latest/viewpoints");

    return data.items;
  }

  async getViewpoint(viewpointId: string): Promise<Viewpoint> {
    return tileServerApiClient.get(`/latest/viewpoints/${viewpointId}`);
  }

  async createViewpoint(
    createViewpointData: CreateViewpointRequest
  ): Promise<Viewpoint> {
    return tileServerApiClient.post("/latest/viewpoints", createViewpointData);
  }

  async getViewpointBounds(viewpointId: string): Promise<ViewpointBounds> {
    return tileServerApiClient.get(
      `/latest/viewpoints/${viewpointId}/image/bounds`
    );
  }

  async getViewpointMetadata(viewpointId: string): Promise<ViewpointMetadata> {
    return tileServerApiClient.get(
      `/latest/viewpoints/${viewpointId}/image/metadata`
    );
  }

  async getViewpointInfo(viewpointId: string): Promise<ViewpointInfo> {
    return tileServerApiClient.get(
      `/latest/viewpoints/${viewpointId}/image/info`
    );
  }

  async getViewpointStatistics(
    viewpointId: string
  ): Promise<ViewpointStatistics> {
    return tileServerApiClient.get(
      `/latest/viewpoints/${viewpointId}/image/statistics`
    );
  }

  async getViewpointExtentWGS84(
    viewpointId: string
  ): Promise<ViewpointExtent | undefined> {
    try {
      const statistics = await this.getViewpointStatistics(viewpointId);

      const wgs84Extent = (
        statistics.image_statistics as
          | { wgs84Extent?: { coordinates?: number[][][] } }
          | undefined
      )?.wgs84Extent;
      const polygonCoordinates = wgs84Extent?.coordinates?.[0];

      if (!polygonCoordinates || !Array.isArray(polygonCoordinates)) {
        return undefined;
      }

      // Extract all longitude and latitude values from the polygon points
      const lons = polygonCoordinates.map((point) => point[0]);
      const lats = polygonCoordinates.map((point) => point[1]);

      return {
        minLon: Math.min(...lons),
        minLat: Math.min(...lats),
        maxLon: Math.max(...lons),
        maxLat: Math.max(...lats)
      };
    } catch {
      return undefined;
    }
  }

  async deleteViewpoint(viewpointId: string): Promise<Viewpoint> {
    return tileServerApiClient.delete(`/latest/viewpoints/${viewpointId}`);
  }
}

export const viewpointService = new ViewpointService();
