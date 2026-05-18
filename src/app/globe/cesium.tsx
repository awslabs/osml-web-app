// Copyright Amazon.com, Inc. or its affiliates.
import {
  BillboardGraphics,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  defined,
  Entity,
  GeoJsonDataSource,
  HeightReference,
  HorizontalOrigin,
  ImageryProvider,
  Math as CesiumMath,
  ScreenSpaceEventType,
  TerrainProvider,
  VerticalOrigin,
  Viewer as CesiumViewer
} from "cesium";
import { useEffect, useMemo, useRef, useState } from "react";
import { Viewer } from "resium";

import { useImageryTileEffect } from "@/app/globe/useImageryTileEffect";
import {
  GlobeFeaturePopup,
  type GlobeFeaturePopupData
} from "@/components/globe/globe-feature-popup";
import { dataCatalogService } from "@/services/data-catalog-service";
import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import { useAppDispatch, useAppSelector } from "@/store/hooks.ts";
import {
  DEFAULT_RESULT_STYLE,
  selectLayerStyles
} from "@/store/slices/jobs-slice.ts";
import type {
  FeatureStyle,
  OverlayLayer
} from "@/store/slices/overlay-slice.ts";
import { selectFeature } from "@/store/slices/overlay-slice.ts";
import {
  selectAutoZoom,
  selectGlobeSettings
} from "@/store/slices/settings-slice.ts";
import { setViewport } from "@/store/slices/viewport-slice.ts";
import { extractClassification } from "@/utils/analytics/extract-classification";
import { extractConfidence } from "@/utils/analytics/extract-confidence";
import { CLASSIFICATION_PALETTE } from "@/utils/analytics/types";
import {
  computeLoadedDetectionJobIds,
  diffNewlyLoaded
} from "@/utils/auto-zoom";
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
  const prevVisibleJobIdsRef = useRef<Set<string>>(new Set());

  const dispatch = useAppDispatch();
  const viewport = useAppSelector((state) => state.viewport);
  const inlineAgentFeatures = useAppSelector(
    (state) => state.overlay.inlineFeatures["agent-features"]
  );
  const features = inlineAgentFeatures ?? emptyFeatures;
  const overlayLayers = useAppSelector((state) => state.overlay.layers);
  const layerOrder = useAppSelector((state) => state.overlay.layerOrder);
  const layerStyles = useAppSelector(selectLayerStyles);
  const autoZoom = useAppSelector(selectAutoZoom);
  const globeSettings = useAppSelector(selectGlobeSettings);
  const confidenceThreshold = useAppSelector(
    (state) => state.analytics?.confidenceThreshold ?? 0
  );
  const colorMode = useAppSelector(
    (state) => state.analytics?.colorMode ?? "layer"
  );

  // Stabilize references to prevent infinite re-render loops
  const overlayLayersRef = useRef(overlayLayers);
  const overlayLayersKey = JSON.stringify(overlayLayers);
  const prevOverlayLayersKey = useRef(overlayLayersKey);
  if (prevOverlayLayersKey.current !== overlayLayersKey) {
    prevOverlayLayersKey.current = overlayLayersKey;
    overlayLayersRef.current = overlayLayers;
  }
  const stableOverlayLayers = overlayLayersRef.current;

  const layerOrderRef = useRef(layerOrder);
  const layerOrderKey = JSON.stringify(layerOrder);
  const prevLayerOrderKey = useRef(layerOrderKey);
  if (prevLayerOrderKey.current !== layerOrderKey) {
    prevLayerOrderKey.current = layerOrderKey;
    layerOrderRef.current = layerOrder;
  }
  const stableLayerOrder = layerOrderRef.current;

  const layerStylesRef = useRef(layerStyles);
  const layerStylesKey = JSON.stringify(layerStyles);
  const prevLayerStylesKey = useRef(layerStylesKey);
  if (prevLayerStylesKey.current !== layerStylesKey) {
    prevLayerStylesKey.current = layerStylesKey;
    layerStylesRef.current = layerStyles;
  }
  const stableLayerStyles = layerStylesRef.current;

  // Render imagery tiles for selected jobs on the globe
  useImageryTileEffect(viewerRef.current);

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

  // Handle overlay layer rendering on globe (agent features + detection layers)
  useEffect(() => {
    if (!viewerRef.current || !viewerReady) return;

    const viewer = viewerRef.current;
    const cache = GeoJSONCacheService.getInstance();

    // Remove all existing data sources (clean slate approach)
    viewer.dataSources.removeAll();

    // Helper function for styling entities
    const applyEntityStyling = (
      entity: Entity,
      style: Partial<FeatureStyle>
    ) => {
      // Convert hex colors to Cesium Color
      const hexToColor = (hex: string, opacity: number = 1) => {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;

        return Color.fromAlpha(
          Color.fromBytes(r * 255, g * 255, b * 255),
          opacity
        );
      };

      const fillColor = style.fillColor || "#3388ff";
      const strokeColor = style.color || "#3388ff";
      const fillOpacity = style.fillOpacity || 0.2;
      const strokeOpacity = style.opacity || 0.8;
      const strokeWidth = style.weight || 3;

      // Apply styling based on geometry type
      if (entity.polygon) {
        entity.polygon.material = new ColorMaterialProperty(
          hexToColor(fillColor, fillOpacity)
        );
        entity.polygon.outline = new ConstantProperty(true);
        entity.polygon.outlineColor = new ConstantProperty(
          hexToColor(strokeColor, strokeOpacity)
        );
        entity.polygon.outlineWidth = new ConstantProperty(strokeWidth);
        entity.polygon.height = new ConstantProperty(0);
        entity.polygon.extrudedHeight = new ConstantProperty(0);
      }

      if (entity.polyline) {
        entity.polyline.material = new ColorMaterialProperty(
          hexToColor(strokeColor, strokeOpacity)
        );
        entity.polyline.width = new ConstantProperty(strokeWidth);
        entity.polyline.clampToGround = new ConstantProperty(true);
      }

      if (entity.point) {
        const pointRadius = style.radius || 8;
        const pixelSize = Math.max(8, pointRadius * 1.5);

        if (style.icon) {
          entity.billboard = new BillboardGraphics({
            image: new ConstantProperty(style.icon),
            scale: new ConstantProperty(style.iconScale || 1),
            color: new ConstantProperty(hexToColor(strokeColor, strokeOpacity)),
            heightReference: new ConstantProperty(
              HeightReference.CLAMP_TO_GROUND
            ),
            disableDepthTestDistance: new ConstantProperty(
              Number.POSITIVE_INFINITY
            )
          });
          entity.point = undefined;
        } else {
          entity.point.color = new ConstantProperty(
            hexToColor(fillColor, fillOpacity)
          );
          entity.point.outlineColor = new ConstantProperty(
            hexToColor(strokeColor, strokeOpacity)
          );
          entity.point.outlineWidth = new ConstantProperty(
            Math.max(1, strokeWidth)
          );
          entity.point.pixelSize = new ConstantProperty(pixelSize);
          entity.point.heightReference = new ConstantProperty(
            HeightReference.CLAMP_TO_GROUND
          );
          entity.point.scaleByDistance = new ConstantProperty({
            near: 1000,
            nearValue: 1.5,
            far: 10000000,
            farValue: 0.5
          });
        }
      }
    };

    // --- Render detection layers from overlay slice + GeoJSONCacheService ---
    // Presence in overlay.layers = should render. The middleware manages
    // overlay presence based on job selection; there is no visibility flag.
    const detectionLoadPromises: Array<{
      jobId: string;
      dataSource: GeoJsonDataSource;
      loadPromise: Promise<void>;
    }> = [];
    for (const layerId of stableLayerOrder) {
      const layer: OverlayLayer | undefined = stableOverlayLayers[layerId];
      if (!layer) continue;
      if (layer.source !== "detection") continue;
      if (layer.metadata?.loading || layer.metadata?.error) continue;

      const geoJsonData = cache.get(layerId);
      if (!geoJsonData) continue;

      // Get per-job style from jobs-slice, fall back to default
      const jobId = layer.metadata?.jobId;
      const jobStyle =
        (jobId && stableLayerStyles[jobId]) || DEFAULT_RESULT_STYLE;

      const detectionDataSource = new GeoJsonDataSource(layerId);
      const classificationColors: Record<string, string> = {};
      const palette = CLASSIFICATION_PALETTE;
      let paletteIdx = 0;

      const loadPromise = detectionDataSource.load(geoJsonData).then(() => {
        detectionDataSource.entities.values.forEach((entity) => {
          entity.name = `${jobId}::${entity.id}`;

          // Determine color based on colorMode
          let entityColor = jobStyle.color;
          let entityOpacity = jobStyle.opacity;

          if (colorMode !== "layer" && entity.properties) {
            const props = entity.properties.getValue(
              viewer.clock.currentTime
            ) as Record<string, unknown>;
            if (props) {
              if (colorMode === "confidence") {
                const conf = extractConfidence(props);
                if (conf !== undefined) {
                  const r =
                    conf < 0.5
                      ? 255
                      : Math.round((1.0 - (conf - 0.5) * 2) * 255);
                  const g = conf < 0.5 ? Math.round(conf * 2 * 255) : 255;
                  entityColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}00`;
                } else {
                  entityColor = "#808080";
                }
              } else if (colorMode === "classification") {
                const cls = extractClassification(props);
                if (cls) {
                  if (!classificationColors[cls]) {
                    classificationColors[cls] =
                      palette[paletteIdx % palette.length];
                    paletteIdx++;
                  }
                  entityColor = classificationColors[cls];
                } else {
                  entityColor = "#808080";
                }
              }
            }
          }

          applyEntityStyling(entity, {
            fillColor: entityColor,
            color: entityColor,
            fillOpacity: entityOpacity * 0.6,
            opacity: entityOpacity,
            weight: 2
          });

          if (entity.polygon || entity.polyline) {
            entity.billboard = undefined;
            entity.point = undefined;
          }

          if (confidenceThreshold > 0 && entity.properties) {
            const props = entity.properties.getValue(
              viewer.clock.currentTime
            ) as Record<string, unknown>;
            if (props) {
              const conf = extractConfidence(props);
              if (conf !== undefined && conf < confidenceThreshold) {
                entity.show = false;
              }
            }
          }
        });
      });
      viewer.dataSources.add(detectionDataSource);
      if (jobId) {
        detectionLoadPromises.push({
          jobId,
          dataSource: detectionDataSource,
          loadPromise
        });
      }
    }

    // Auto-zoom should fire when a detection layer's data just finished
    // loading — not when the loading-state layer record first appears.
    // Track the set of jobs whose detection data is currently loaded and
    // compute the "newly ready" diff against the previous render.
    const currentVisibleJobIds =
      computeLoadedDetectionJobIds(stableOverlayLayers);
    const newlyVisibleSet = diffNewlyLoaded(
      currentVisibleJobIds,
      prevVisibleJobIdsRef.current
    );
    const newlyVisible: string[] = Array.from(newlyVisibleSet);
    prevVisibleJobIdsRef.current = currentVisibleJobIds;

    if (autoZoom && newlyVisible.length > 0) {
      const targetJobId = newlyVisible[newlyVisible.length - 1];
      const targetEntry = detectionLoadPromises.find(
        (e) => e.jobId === targetJobId
      );
      if (targetEntry) {
        targetEntry.loadPromise.then(() => {
          const v = viewerRef.current;
          if (!v || targetEntry.dataSource.entities.values.length === 0) return;

          // Compute bounding sphere from entity centroids (handles points, polygons, polylines)
          const entities = targetEntry.dataSource.entities.values;
          const centroids: Cartesian3[] = [];
          for (const entity of entities) {
            // Point entities have a position
            const pos = entity.position?.getValue(v.clock.currentTime) as
              | Cartesian3
              | undefined;
            if (pos) {
              centroids.push(pos);
              continue;
            }
            // Polygon entities — compute centroid from hierarchy positions
            const hierarchy = entity.polygon?.hierarchy?.getValue(
              v.clock.currentTime
            ) as { positions: Cartesian3[] } | undefined;
            if (hierarchy?.positions && hierarchy.positions.length > 0) {
              const pts = hierarchy.positions as Cartesian3[];
              const sum = pts.reduce(
                (acc, p) =>
                  new Cartesian3(acc.x + p.x, acc.y + p.y, acc.z + p.z),
                new Cartesian3(0, 0, 0)
              );
              centroids.push(
                new Cartesian3(
                  sum.x / pts.length,
                  sum.y / pts.length,
                  sum.z / pts.length
                )
              );
              continue;
            }
            // Polyline entities — compute centroid from positions
            const linePositions = entity.polyline?.positions?.getValue(
              v.clock.currentTime
            ) as Cartesian3[] | undefined;
            if (linePositions && linePositions.length > 0) {
              const pts = linePositions as Cartesian3[];
              const sum = pts.reduce(
                (acc, p) =>
                  new Cartesian3(acc.x + p.x, acc.y + p.y, acc.z + p.z),
                new Cartesian3(0, 0, 0)
              );
              centroids.push(
                new Cartesian3(
                  sum.x / pts.length,
                  sum.y / pts.length,
                  sum.z / pts.length
                )
              );
            }
          }

          if (centroids.length > 0) {
            const sphere = BoundingSphere.fromPoints(centroids);
            const center = Cartographic.fromCartesian(sphere.center);
            // Height based on bounding sphere radius — enough to see all features
            const height = Math.max(sphere.radius * 3, 5000);

            v.camera.flyTo({
              destination: Cartesian3.fromRadians(
                center.longitude,
                center.latitude,
                height
              ),
              orientation: {
                heading: 0,
                pitch: CesiumMath.toRadians(-90), // Straight down (nadir)
                roll: 0
              },
              duration: 1.5
            });
          } else {
            // Fallback: use viewer.flyTo if positions can't be extracted
            v.flyTo(targetEntry.dataSource, { duration: 1.5 });
          }
        });
      }
    }

    // --- Render agent features from inline features ---
    if (features.length === 0) {
      // Still set up click handler even with no agent features (detection layers may exist)
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
              if (entity.properties) {
                const vals = entity.properties.getValue(
                  viewer.clock.currentTime
                ) as Record<string, unknown> | undefined;
                if (vals) Object.assign(rawProps, vals);
              }
              const { title, groups } = formatEntityProperties(rawProps);
              addClickMarker(viewer, position, "#3388ff");
              setPopupData({ position, groups, color: "#3388ff", title });
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
    }

    // HYBRID APPROACH: Handle both direct GeoJSON and STAC URL features
    const stacFeatures = features.filter(
      (f) => f.properties.dataSource === "stac_url"
    );
    const directFeatures = features.filter(
      (f) => f.properties.dataSource !== "stac_url"
    );

    // Process STAC URL features through authenticated service
    stacFeatures.forEach(async (feature) => {
      try {
        // Extract collection and item ID from STAC URL
        const stacUrl = feature.properties.stacUrl as string | undefined;
        if (!stacUrl) return;
        const urlParts = stacUrl.split("/");
        const collectionIndex = urlParts.indexOf("collections");
        const itemsIndex = urlParts.indexOf("items");

        if (collectionIndex !== -1 && itemsIndex !== -1) {
          const collectionId = urlParts[collectionIndex + 1];
          const itemId = urlParts[itemsIndex + 1];

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
  }, [
    features,
    stableOverlayLayers,
    stableLayerOrder,
    stableLayerStyles,
    viewerReady,
    dispatch,
    autoZoom,
    confidenceThreshold,
    colorMode
  ]);

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
