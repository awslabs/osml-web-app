// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import "ol/ol.css";

import { useSession } from "next-auth/react";
import MousePosition from "ol/control/MousePosition";
import TileLayer from "ol/layer/Tile";
import WebGLTileLayer from "ol/layer/WebGLTile";
import Map from "ol/Map";
import { Projection } from "ol/proj";
import ImageTile from "ol/source/ImageTile";
import Zoomify from "ol/source/Zoomify";
import View from "ol/View";
import { useEffect, useRef, useState } from "react";

import { ImageViewerSidebar } from "@/components/sidebars/image-viewer-sidebar.tsx";
import { Sidebar } from "@/components/sidebars/sidebar.tsx";
import { siteConfig } from "@/config/site.ts";
import {
  AutoAdjustProvider,
  useAutoAdjust
} from "@/contexts/auto-adjust-context";
import { useAppDispatch, useAppSelector } from "@/store/hooks.ts";
import { fetchViewpoints } from "@/store/slices/image-viewer-slice.ts";
import { createAuthenticatedTileLoader } from "@/utils/ol-tile-auth";
import {
  adjustmentsToStyleVariables,
  isWebGLSupported
} from "@/utils/webgl.ts";

function ImagePageContent() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<Map | null>(null);
  const currentLayer = useRef<TileLayer<Zoomify> | WebGLTileLayer | null>(null);
  const [webglSupported, setWebglSupported] = useState<boolean>(true);
  const { data: session } = useSession();
  const dispatch = useAppDispatch();
  const autoAdjustContext = useAutoAdjust();
  const { selectedViewpoint, viewpointBounds, viewpoints } = useAppSelector(
    (state) => state.imageViewer
  );
  const currentAdjustments = useAppSelector(
    (state) => state.imageViewer.currentAdjustments
  );

  useEffect(() => {
    dispatch(fetchViewpoints());
  }, [dispatch]);

  // Use shared authenticated tile loader from utils
  const authenticatedTileLoadFunction = () => createAuthenticatedTileLoader();

  // Initialize map
  useEffect(() => {
    if (!mapRef.current) return;

    // Check WebGL support on mount
    setWebglSupported(isWebGLSupported());

    mapInstance.current = new Map({
      target: mapRef.current,
      controls: []
    });

    const handleResize = () => {
      mapInstance.current?.updateSize();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      mapInstance.current?.setTarget(undefined);
      mapInstance.current = null;
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Update layer when viewpoint changes
  useEffect(() => {
    if (
      !mapInstance.current ||
      !selectedViewpoint ||
      !viewpointBounds.bounds ||
      viewpointBounds.bounds.length !== 4
    )
      return;

    const viewpoint = viewpoints.find(
      (v) => v.viewpoint_id === selectedViewpoint.viewpointId
    );

    if (!viewpoint) return;

    const bounds = viewpointBounds.bounds;
    const tileSize = viewpoint.tile_size;
    const viewpointId = viewpoint.viewpoint_id;

    const w = bounds[2] - bounds[0];
    const h = bounds[3] - bounds[1];
    const zoomOffset = Math.ceil(Math.sqrt(Math.max(w, h) / tileSize));

    const url = `${siteConfig.tile_server_base_url}/latest/viewpoints/${viewpointId}/image/tiles/{z}/{x}/{y}.PNG?compression=NONE`;

    // Create Zoomify source to get the tile grid configuration
    // Zoomify calculates the proper tile grid for the image dimensions
    const zoomifySource = new Zoomify({
      size: [w, h],
      url: "",
      tileSize: tileSize
    });

    const defaultExtent = [0, 0, 100, 100];
    const extent = zoomifySource.getTileGrid()?.getExtent() ?? defaultExtent;
    const tileGrid = zoomifySource.getTileGrid();

    const projection = new Projection({
      code: "image",
      units: "pixels",
      extent: extent
    });

    // Custom URL function for tile coordinates
    const tileUrlFunction = (tileCoord: number[]) =>
      url
        .replace("{z}", (zoomOffset - tileCoord[0]).toString())
        .replace("{x}", tileCoord[1].toString())
        .replace("{y}", tileCoord[2].toString());

    // Configure Zoomify source for fallback TileLayer
    zoomifySource.setTileUrlFunction(tileUrlFunction);
    zoomifySource.setTileLoadFunction(authenticatedTileLoadFunction());

    // Remove existing layer and controls
    if (currentLayer.current) {
      mapInstance.current.removeLayer(currentLayer.current);
    }

    mapInstance.current.getControls().forEach((control) => {
      if (control instanceof MousePosition) {
        mapInstance.current?.removeControl(control);
      }
    });

    // Create layer based on WebGL support
    let viewpointLayer: TileLayer<Zoomify> | WebGLTileLayer;

    if (webglSupported) {
      // Create ImageTile source for WebGLTileLayer
      // WebGLTileLayer requires ImageTile or DataTileSource, not Zoomify
      const imageTileSource = new ImageTile({
        tileGrid: tileGrid!,
        projection: projection,
        crossOrigin: "anonymous",
        // Custom loader that handles authentication for ImageTile
        loader: async (z, x, y) => {
          const tileUrl = url
            .replace("{z}", (zoomOffset - z).toString())
            .replace("{x}", x.toString())
            .replace("{y}", y.toString());

          // Fetch session token for authentication
          let accessToken = "";
          try {
            const sessionResponse = await fetch("/api/auth/session");
            if (sessionResponse.ok) {
              const freshSession = (await sessionResponse.json()) as {
                accessToken?: string;
              };
              if (freshSession?.accessToken) {
                accessToken = freshSession.accessToken;
              }
            }
          } catch {
            // Continue without token
          }

          // Fetch the tile with authentication
          const headers: HeadersInit = {};
          if (accessToken) {
            headers["Authorization"] = `Bearer ${accessToken}`;
          }

          const response = await fetch(tileUrl, { headers });
          if (!response.ok) {
            throw new Error(`Failed to load tile: ${response.status}`);
          }

          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);

          // Create and load the image
          return new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              URL.revokeObjectURL(blobUrl);
              resolve(img);
            };
            img.onerror = () => {
              URL.revokeObjectURL(blobUrl);
              reject(new Error(`Failed to decode tile image: ${tileUrl}`));
            };
            img.src = blobUrl;
          });
        }
      });

      // Create WebGLTileLayer with style variables for image adjustments
      // Requirements: 1.1, 1.2, 1.3
      viewpointLayer = new WebGLTileLayer({
        className: viewpointId,
        source: imageTileSource,
        style: {
          variables: adjustmentsToStyleVariables(currentAdjustments),
          // Style expressions referencing variables (Requirement 1.3)
          exposure: ["var", "exposure"],
          contrast: ["var", "contrast"],
          saturation: ["var", "saturation"],
          gamma: ["var", "gamma"],
          // Color expression for RGB band multiplication (Requirement 6.6)
          color: [
            "array",
            ["*", ["band", 1], ["var", "redGain"]],
            ["*", ["band", 2], ["var", "greenGain"]],
            ["*", ["band", 3], ["var", "blueGain"]],
            ["band", 4] // Alpha channel unchanged
          ]
        }
      });
    } else {
      // Fall back to standard TileLayer if WebGL not supported (Requirement 1.5)
      // Zoomify source works well with regular TileLayer
      viewpointLayer = new TileLayer({
        className: viewpointId,
        source: zoomifySource
      });
    }

    const viewpointView = new View({
      projection: projection,
      extent: extent,
      constrainOnlyCenter: true,
      // Use resolutions from the tile grid for proper zoom levels
      resolutions: tileGrid?.getResolutions()
    });

    // Update map with new view and layer
    mapInstance.current.setView(viewpointView);
    mapInstance.current.addLayer(viewpointLayer);

    currentLayer.current = viewpointLayer;
    viewpointView.fit(extent);

    // Register the new layer with auto-adjust context
    if (autoAdjustContext) {
      const webglLayer =
        viewpointLayer instanceof WebGLTileLayer ? viewpointLayer : null;
      autoAdjustContext.registerMapAndLayer(mapInstance.current, webglLayer);
    }

    // const mousePositionControl = new MousePosition({
    //   coordinateFormat: createStringXY(4),
    //   projection: projection,
    // });
    //
    // mapInstance.current.addControl(mousePositionControl);
    //
    // `currentAdjustments` is intentionally omitted from deps; the sync
    // effect below applies slider changes to the existing layer instead of
    // recreating it (which would re-fetch tiles).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedViewpoint,
    viewpointBounds,
    viewpoints,
    session,
    webglSupported,
    autoAdjustContext
  ]);

  // Sync Redux adjustments to WebGLTileLayer
  // Requirements: 1.4, 2.2, 3.2, 4.2, 5.2, 6.2
  useEffect(() => {
    // Only update if we have a WebGL layer
    if (!currentLayer.current || !webglSupported) return;

    // Check if the layer is a WebGLTileLayer (has updateStyleVariables method)
    if (currentLayer.current instanceof WebGLTileLayer) {
      currentLayer.current.updateStyleVariables(
        adjustmentsToStyleVariables(currentAdjustments)
      );
    }
    // Include selectedViewpoint to ensure adjustments are synced after viewpoint switch
  }, [currentAdjustments, webglSupported, selectedViewpoint]);

  return (
    <>
      <Sidebar>
        <ImageViewerSidebar />
      </Sidebar>
      <div className="w-full h-full">
        <div ref={mapRef} className="w-full h-full" />
      </div>
    </>
  );
}

/**
 * Image page component wrapped with AutoAdjustProvider.
 * This allows child components to access the auto-adjust functionality.
 */
export default function ImagePage() {
  return (
    <AutoAdjustProvider>
      <ImagePageContent />
    </AutoAdjustProvider>
  );
}
