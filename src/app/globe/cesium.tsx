// Copyright Amazon.com, Inc. or its affiliates.
import {
  BillboardGraphics,
  Cartesian2,
  Cartesian3,
  ConstantProperty,
  defined,
  Entity,
  GeoJsonDataSource,
  HorizontalOrigin,
  ImageryProvider,
  ScreenSpaceEventType,
  TerrainProvider,
  VerticalOrigin,
  Viewer as CesiumViewer
} from "cesium";
import { useEffect, useMemo, useRef, useState } from "react";
import { Viewer } from "resium";

import { applyEntityStyling } from "@/app/globe/cesium-entity-styling";
import { useDetectionLayers } from "@/app/globe/useDetectionLayers";
import { useImageryTileEffect } from "@/app/globe/useImageryTileEffect";
import {
  GlobeFeaturePopup,
  type GlobeFeaturePopupData
} from "@/components/globe/globe-feature-popup";
import { dataCatalogService } from "@/services/data-catalog-service";
import { useAppDispatch, useAppSelector } from "@/store/hooks.ts";
import type { FeatureStyle } from "@/store/slices/overlay-slice.ts";
import { selectFeature } from "@/store/slices/overlay-slice.ts";
import {
  selectAutoZoom,
  selectGlobeSettings
} from "@/store/slices/settings-slice.ts";
import { setViewport } from "@/store/slices/viewport-slice.ts";
import { pickAutoZoomFeatureId } from "@/utils/auto-zoom.ts";
import {
  calculateZoomFromExtent,
  cartesian3ToWGS84,
  extentToHeight,
  rectangleToExtent,
  wgs84ToCartesian3
} from "@/utils/coordinate-transformers-cesium.ts";
import { formatEntityProperties } from "@/utils/globe-popup-formatter.ts";
import {
  generateImageryProviders,
  generateProviderViewModels,
  generateTerrainProviders,
  generateTerrainProviderViewModels
} from "@/utils/globe-providers.ts";
import { parseStacItemUrl } from "@/utils/map-rendering";

interface ViewerConfig {
  imageryProvider: ImageryProvider;
  terrainProvider: TerrainProvider;
}

import type { GeoJSONFeature } from "@/store/slices/overlay-slice.ts";
import { buildMarkerSvg } from "@/utils/color-utils";

const emptyFeatures: GeoJSONFeature[] = [];

/** Extract a world position from a Cesium entity (point, polygon centroid, or polyline start). */
function getEntityPosition(
  entity: Entity,
  viewer: CesiumViewer
): Cartesian3 | undefined {
  const now = viewer.clock.currentTime;
  // Point entities
  const pos = entity.position?.getValue(now) as Cartesian3 | undefined;
  if (pos) return pos;
  // Polygon centroid
  const hierarchy = entity.polygon?.hierarchy?.getValue(now) as
    | { positions: Cartesian3[] }
    | undefined;
  if (hierarchy?.positions && hierarchy.positions.length > 0) {
    const pts = hierarchy.positions as Cartesian3[];
    const sum = pts.reduce(
      (acc: Cartesian3, p: Cartesian3) =>
        new Cartesian3(acc.x + p.x, acc.y + p.y, acc.z + p.z),
      new Cartesian3(0, 0, 0)
    );
    return new Cartesian3(
      sum.x / pts.length,
      sum.y / pts.length,
      sum.z / pts.length
    );
  }
  // Polyline first point
  const linePositions = entity.polyline?.positions?.getValue(now) as
    | Cartesian3[]
    | undefined;
  if (linePositions && linePositions.length > 0) return linePositions[0];
  return undefined;
}

/** Remove all billboard-only marker entities previously added by click handling. */
function clearClickMarkers(viewer: CesiumViewer): void {
  const entities = viewer.entities.values;
  for (let i = entities.length - 1; i >= 0; i--) {
    if (entities[i].billboard && entities[i].name === "__click-marker__") {
      viewer.entities.remove(entities[i]);
    }
  }
}

/** Add a small billboard marker at the given world position. */
function addClickMarker(
  viewer: CesiumViewer,
  position: Cartesian3,
  cssColor: string
): void {
  clearClickMarkers(viewer);
  viewer.entities.add({
    name: "__click-marker__",
    position,
    billboard: new BillboardGraphics({
      image: new ConstantProperty(buildMarkerSvg(cssColor)),
      verticalOrigin: new ConstantProperty(VerticalOrigin.CENTER),
      horizontalOrigin: new ConstantProperty(HorizontalOrigin.CENTER),
      scale: new ConstantProperty(1.0),
      disableDepthTestDistance: new ConstantProperty(Number.POSITIVE_INFINITY)
    })
  });
}

export default function Cesium() {
  "use no memo";

  const viewerRef = useRef<CesiumViewer | null>(null);
  const [viewerConfig, setViewerConfig] = useState<ViewerConfig | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [popupData, setPopupData] = useState<GlobeFeaturePopupData | null>(
    null
  );
  // Agent/STAC feature ids already auto-zoomed to, so the camera flies only to
  // newly-added features.
  const prevAgentFeatureIdsRef = useRef<Set<string>>(new Set());

  const dispatch = useAppDispatch();
  const viewport = useAppSelector((state) => state.viewport);
  const inlineAgentFeatures = useAppSelector(
    (state) => state.overlay.inlineFeatures["agent-features"]
  );
  const features = inlineAgentFeatures ?? emptyFeatures;
  const globeSettings = useAppSelector(selectGlobeSettings);
  const autoZoom = useAppSelector(selectAutoZoom);

  // Render imagery tiles and detection layers for selected jobs on the globe.
  // Detection layers are reconciled (diff-based) so GeoJSON is not re-parsed
  // on style/color-mode/threshold changes.
  useImageryTileEffect(viewerRef.current);
  useDetectionLayers(viewerRef.current, viewerReady);

  // Apply globe rendering settings from Redux
  useEffect(() => {
    if (!viewerRef.current || !viewerReady) return;
    const scene = viewerRef.current.scene;

    scene.globe.enableLighting = globeSettings.enableLighting;
    scene.globe.showGroundAtmosphere = globeSettings.showGroundAtmosphere;
    if (scene.skyAtmosphere)
      scene.skyAtmosphere.show = globeSettings.showSkyAtmosphere;
    if (scene.sun) scene.sun.show = globeSettings.enableLighting;
    scene.fog.enabled = globeSettings.enableFog;
    scene.fog.density = 0.0003;
    scene.fog.minimumBrightness = 0.02;
  }, [viewerReady, globeSettings]);

  // Generate provider view models once
  const providerViewModels = useMemo(() => generateProviderViewModels(), []);
  const terrainProviderViewModels = useMemo(
    () => generateTerrainProviderViewModels(),
    []
  );

  // Load providers before first render
  useEffect(() => {
    const initializeViewer = async () => {
      try {
        const [imageryProviders, terrainProviders] = await Promise.all([
          generateImageryProviders(),
          generateTerrainProviders()
        ]);

        if (imageryProviders.length > 0 && terrainProviders.length > 0) {
          setViewerConfig({
            imageryProvider: imageryProviders[0],
            terrainProvider: terrainProviders[0]
          });
        }
      } catch {
        void 0;
      }
    };

    initializeViewer();
  }, []);

  // Add viewport synchronization listeners after viewer is ready
  useEffect(() => {
    if (!viewerRef.current || !viewerReady) {
      return;
    }

    const viewer = viewerRef.current;
    let moveTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleCameraChanged = () => {
      // Debounce to prevent excessive updates
      if (moveTimeout) clearTimeout(moveTimeout);
      moveTimeout = setTimeout(() => {
        if (!viewer) return;

        const camera = viewer.camera;
        const position = camera.positionWC;
        const wgs84Position = cartesian3ToWGS84(position);

        // Update Redux state with actual visible extent
        const rectangle = camera.computeViewRectangle();

        if (rectangle) {
          const extent = rectangleToExtent(rectangle);
          const extentWidth = Math.abs(extent.east - extent.west);
          const extentHeight = Math.abs(extent.north - extent.south);

          // Skip full world extents to avoid coordinate issues
          if (extentWidth < 350 && extentHeight < 170) {
            dispatch(
              setViewport({
                longitude: wgs84Position.longitude,
                latitude: wgs84Position.latitude,
                zoom: calculateZoomFromExtent(extent),
                extent,
                updatedBy: "globe"
              })
            );
          }
        }
      }, 300); // 300ms debounce
    };

    // Listen for camera changes
    viewer.camera.changed.addEventListener(handleCameraChanged);

    return () => {
      if (moveTimeout) clearTimeout(moveTimeout);
      viewer.camera.changed.removeEventListener(handleCameraChanged);
    };
  }, [dispatch, viewerReady]); // Re-run when viewer is ready

  // Initialize Cesium camera with Redux state when viewer is first ready
  useEffect(() => {
    if (!viewerRef.current || !viewerReady || initialized) return;

    const viewer = viewerRef.current;

    try {
      // Use extent-based height calculation for better correspondence with OpenLayers
      const height = extentToHeight(viewport.extent, viewport.latitude);
      const destination = wgs84ToCartesian3({
        longitude: viewport.longitude,
        latitude: viewport.latitude,
        height
      });

      // Set initial view without animation
      viewer.camera.setView({
        destination
      });

      setInitialized(true);
    } catch {
      // Fall back to default initialization if viewport state is problematic
      setInitialized(true);
    }
  }, [viewerReady, initialized, viewport]);

  // Listen for agent-triggered viewport changes
  useEffect(() => {
    if (!viewerRef.current || !viewerReady || !initialized) return;
    if (viewport.lastUpdatedBy !== "agent") return;

    const viewer = viewerRef.current;

    // Use extent-based height calculation for better correspondence with map
    const height = extentToHeight(viewport.extent, viewport.latitude);
    const destination = wgs84ToCartesian3({
      longitude: viewport.longitude,
      latitude: viewport.latitude,
      height
    });

    // Navigate to the new location with smooth animation
    viewer.camera.flyTo({
      destination,
      duration: 1.5 // 1.5 second animation
    });
  }, [viewport, viewerReady, initialized]);

  // Render agent-drawn features (direct GeoJSON + STAC URLs) and wire the
  // click handler. Detection/imagery layers are owned by their own hooks, so
  // this effect only manages the agent/STAC data sources it creates.
  useEffect(() => {
    if (!viewerRef.current || !viewerReady) return;

    const viewer = viewerRef.current;

    // Remove only the agent/STAC data sources we own (never detection sources,
    // which useDetectionLayers reconciles independently).
    const ownSources: GeoJsonDataSource[] = [];
    for (let i = 0; i < viewer.dataSources.length; i++) {
      const ds = viewer.dataSources.get(i);
      if (ds.name === "agent-features" || ds.name?.startsWith("stac-")) {
        ownSources.push(ds as GeoJsonDataSource);
      }
    }
    ownSources.forEach((ds) => viewer.dataSources.remove(ds));

    // HYBRID APPROACH: Handle both direct GeoJSON and STAC URL features
    const stacFeatures = features.filter(
      (f) => f.properties.dataSource === "stac_url"
    );
    const directFeatures = features.filter(
      (f) => f.properties.dataSource !== "stac_url"
    );

    // Decide which newly-added feature (if any) to auto-zoom to, then record
    // the current ids so we don't re-zoom on later renders. Flying the camera
    // triggers the camera.changed listener above, which writes the shared
    // viewport (updatedBy "globe") — keeping map and globe consistent.
    const zoomTargetId = pickAutoZoomFeatureId(
      features,
      prevAgentFeatureIdsRef.current,
      autoZoom
    );
    prevAgentFeatureIdsRef.current = new Set(features.map((f) => f.id));

    // Process STAC URL features through authenticated service
    stacFeatures.forEach(async (feature) => {
      try {
        // Extract collection and item ID from STAC URL
        const stacUrl = feature.properties.stacUrl as string | undefined;
        if (!stacUrl) return;
        const parsed = parseStacItemUrl(stacUrl);

        if (parsed) {
          const { collectionId, itemId } = parsed;

          try {
            // Use existing authenticated data catalog service
            const stacItem = await dataCatalogService.getItem(
              collectionId,
              itemId
            );

            // Create data source for this STAC item
            const stacDataSource = new GeoJsonDataSource(`stac-${feature.id}`);
            const featureCollection = {
              type: "FeatureCollection",
              features: [stacItem]
            };

            await stacDataSource.load(featureCollection);
            viewer.dataSources.add(stacDataSource);

            // Apply styling to STAC entities
            stacDataSource.entities.values.forEach((entity) => {
              entity.name = feature.id;
              entity.description = new ConstantProperty(
                feature.properties.description || ""
              );
              applyEntityStyling(entity, feature.properties.style || {});
            });

            // Auto-zoom to this feature if it's the newly-added one.
            if (feature.id === zoomTargetId && !viewer.isDestroyed?.()) {
              void viewer.flyTo(stacDataSource, { duration: 1.5 });
            }
          } catch {
            // STAC item loading failed silently
          }
        }
      } catch {
        // STAC feature processing failed silently
      }
    });

    // Process direct GeoJSON features (existing approach)
    if (directFeatures.length > 0) {
      const geoJsonDataSource = new GeoJsonDataSource("agent-features");
      const featureCollection = {
        type: "FeatureCollection",
        features: directFeatures
      };

      geoJsonDataSource.load(featureCollection).then(() => {
        geoJsonDataSource.entities.values.forEach((entity) => {
          const feature = directFeatures.find((f) => f.id === entity.name);

          if (!feature) return;

          entity.description = new ConstantProperty(
            feature.properties.description || ""
          );
          entity.name = feature.id;
          applyEntityStyling(entity, feature.properties.style || {});
        });

        // Auto-zoom if the newly-added feature is a direct (non-STAC) one.
        const directZoom = directFeatures.some((f) => f.id === zoomTargetId);
        if (directZoom && !viewer.isDestroyed?.()) {
          void viewer.flyTo(geoJsonDataSource, { duration: 1.5 });
        }
      });

      viewer.dataSources.add(geoJsonDataSource);
    }

    // Add click handler for all features (agent + detection)
    const clickHandler = viewer.screenSpaceEventHandler.setInputAction(
      (event: { position: Cartesian2 }) => {
        const pickedObject = viewer.scene.pick(event.position) as
          | { id?: Entity }
          | undefined;

        if (defined(pickedObject) && defined(pickedObject.id)) {
          const entity = pickedObject.id as Entity;
          // Skip click-marker entities we added ourselves
          if (entity.name === "__click-marker__") return;

          const featureId = entity.name || entity.id;
          dispatch(selectFeature(featureId || undefined));
          viewer.selectedEntity = entity;

          // Build popup data from entity properties
          const position = getEntityPosition(entity, viewer);
          if (position) {
            const rawProps: Record<string, unknown> = {};
            // Try Cesium property bag first (detection layers)
            if (entity.properties) {
              const vals = entity.properties.getValue(
                viewer.clock.currentTime
              ) as Record<string, unknown> | undefined;
              if (vals) Object.assign(rawProps, vals);
            }
            // Also merge inline feature properties (agent/STAC features)
            const inlineFeature = features.find((f) => f.id === featureId);
            if (inlineFeature?.properties) {
              Object.assign(rawProps, inlineFeature.properties);
            }
            const { title, groups } = formatEntityProperties(rawProps);
            const featureColor =
              (inlineFeature?.properties?.style as FeatureStyle | undefined)
                ?.color || "#3388ff";
            addClickMarker(viewer, position, featureColor);
            setPopupData({ position, groups, color: featureColor, title });
          }
        } else {
          dispatch(selectFeature(undefined));
          viewer.selectedEntity = undefined;
          clearClickMarkers(viewer);
          setPopupData(null);
        }
      },
      ScreenSpaceEventType.LEFT_CLICK
    );

    return () => {
      if (viewerRef.current && clickHandler) {
        viewerRef.current.screenSpaceEventHandler.removeInputAction(
          ScreenSpaceEventType.LEFT_CLICK
        );
      }
    };
  }, [features, viewerReady, dispatch, autoZoom]);

  if (!viewerConfig) {
    return <div>Loading Globe...</div>;
  }

  return (
    <>
      <Viewer
        ref={(viewer) => {
          if (viewer?.cesiumElement) {
            viewerRef.current = viewer.cesiumElement;
            setViewerReady(true);
            // Test-only: expose the Cesium viewer so Cypress e2e specs can read
            // the real camera back. Gated out of production builds.
            if (process.env.NODE_ENV !== "production") {
              (
                window as unknown as { __OSML_GLOBE_VIEWER__: unknown }
              ).__OSML_GLOBE_VIEWER__ = viewer.cesiumElement;
            }
          }
        }}
        infoBox={false}
        scene3DOnly
        baseLayerPicker={true}
        geocoder={false}
        homeButton={false}
        imageryProviderViewModels={providerViewModels}
        navigationHelpButton={false}
        selectedImageryProviderViewModel={providerViewModels[0]}
        selectedTerrainProviderViewModel={terrainProviderViewModels[0]}
        style={{
          position: "absolute",
          top: "var(--navbar-height)",
          left: 0,
          right: 0,
          bottom: 0,
          height: "calc(100% - var(--navbar-height))",
          width: "100%"
        }}
        terrainProvider={viewerConfig.terrainProvider}
        terrainProviderViewModels={terrainProviderViewModels}
      />
      {popupData && viewerRef.current && (
        <GlobeFeaturePopup
          data={popupData}
          viewer={viewerRef.current}
          onClose={() => setPopupData(null)}
        />
      )}
    </>
  );
}
