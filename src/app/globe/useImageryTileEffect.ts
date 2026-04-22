// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Custom hook for rendering imagery tiles on the Cesium globe.
 *
 * Subscribes to state.imagery.viewpointData and state.overlay.layers,
 * and manages ImageryLayer instances on the Cesium viewer for each READY
 * viewpoint that has a corresponding imagery overlay layer record.
 *
 * Presence of an `imagery-<jobId>` entry in overlay.layers is the sole
 * rendering signal — the jobs-slice middleware adds the overlay record
 * when a job is selected and removes it on deselection/deletion.
 */

import {
  ImageryLayer,
  Rectangle,
  Resource,
  UrlTemplateImageryProvider,
  type Viewer as CesiumViewer
} from "cesium";
import { useEffect, useRef } from "react";

import { siteConfig } from "@/config/site";
import { useAppSelector } from "@/store/hooks";
import { selectViewpointData } from "@/store/slices/imagery-slice";
import { fetchBearerToken } from "@/utils/cesium-tile-auth";

/**
 * Synchronises Cesium ImageryLayer instances with the Redux imagery state.
 *
 * For each READY viewpoint that has a WGS-84 extent AND a corresponding
 * imagery overlay record, the hook creates a UrlTemplateImageryProvider
 * backed by an authenticated tile URL and adds it to the viewer. When the
 * overlay record is removed (via job deselection/deletion), the tile layer
 * is removed from the viewer.
 */
export function useImageryTileEffect(viewer: CesiumViewer | null): void {
  const viewpointData = useAppSelector(selectViewpointData);
  const overlayLayers = useAppSelector((state) => state.overlay.layers);
  const layerMapRef = useRef<Map<string, ImageryLayer>>(new Map());

  useEffect(() => {
    if (!viewer) return;

    const layerMap = layerMapRef.current;
    let cancelled = false;

    // Determine which job IDs are currently renderable:
    // viewpoint must be READY with extent AND an imagery overlay record
    // must exist (selection drives overlay presence via the middleware)
    const renderableJobIds: Set<string> = new Set();
    Object.entries(viewpointData).forEach(([jobId, vp]) => {
      if (
        !vp.loaded ||
        vp.viewpoint.viewpoint_status !== "READY" ||
        !vp.extent
      ) {
        return;
      }
      // Only render if the imagery layer is present in overlay.layers.
      // Presence is the sole rendering signal; there is no visibility flag.
      const imageryLayerId = `imagery-${jobId}`;
      if (!overlayLayers[imageryLayerId]) {
        return;
      }
      renderableJobIds.add(jobId);
    });

    // Remove layers for viewpoints that are no longer renderable
    Array.from(layerMap.entries()).forEach(([jobId, layer]) => {
      if (!renderableJobIds.has(jobId)) {
        viewer.imageryLayers.remove(layer);
        layerMap.delete(jobId);
      }
    });

    // Collect job IDs that need new layers
    const newJobIds: string[] = [];
    renderableJobIds.forEach((jobId) => {
      if (!layerMap.has(jobId)) {
        newJobIds.push(jobId);
      }
    });

    // Add layers for new renderable viewpoints (async for token fetch)
    if (newJobIds.length > 0) {
      const addLayers = async () => {
        const token = await fetchBearerToken();
        if (cancelled) return;

        for (const jobId of newJobIds) {
          if (layerMap.has(jobId)) continue;

          const vp = viewpointData[jobId];
          if (!vp?.extent) continue;
          const extent = vp.extent;

          const tileUrl =
            `${siteConfig.tile_server_base_url}/latest/viewpoints/` +
            `${vp.viewpoint.viewpoint_id}/map/tiles/WebMercatorQuad/` +
            `{z}/{y}/{x}.PNG?invert_y=true`;

          const resource = new Resource({
            url: tileUrl,
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          });

          const provider = new UrlTemplateImageryProvider({
            url: resource,
            rectangle: Rectangle.fromDegrees(
              extent.minLon,
              extent.minLat,
              extent.maxLon,
              extent.maxLat
            ),
            maximumLevel: 18
          });

          const layer = viewer.imageryLayers.addImageryProvider(provider);
          layerMap.set(jobId, layer);
        }
      };

      addLayers();
    }

    return () => {
      cancelled = true;
    };
  }, [viewer, viewpointData, overlayLayers]);
}
