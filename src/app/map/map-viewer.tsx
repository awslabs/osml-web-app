// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import "ol/ol.css";

import type { FeatureLike } from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import { default as OLMap } from "ol/Map";
import Overlay, { Options as OverlayOptions } from "ol/Overlay";
import { transformExtent } from "ol/proj";
import { OSM, XYZ } from "ol/source";
import VectorSource from "ol/source/Vector";
import Circle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Icon from "ol/style/Icon";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import View from "ol/View";
import DayNight from "ol-ext/source/DayNight";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StacItem } from "stac-ts";

import { FeaturePopup } from "@/components/map/feature-popup.tsx";
import { siteConfig } from "@/config/site.ts";
import { dataCatalogService } from "@/services/data-catalog-service";
import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import { useAppDispatch, useAppSelector } from "@/store/hooks.ts";
import { selectItemViewpoints } from "@/store/slices/data-catalog-slice.ts";
import { selectViewpointData } from "@/store/slices/imagery-slice.ts";
import { DEFAULT_RESULT_STYLE } from "@/store/slices/jobs-slice.ts";
import {
  FeatureStyle,
  GeoJSONFeature,
  selectFeature
} from "@/store/slices/overlay-slice.ts";
import {
  selectAutoZoom,
  selectMapSettings
} from "@/store/slices/settings-slice.ts";
import { setViewport } from "@/store/slices/viewport-slice.ts";
import { store } from "@/store/store.ts";
import { extractClassification } from "@/utils/analytics/extract-classification";
import { extractConfidence } from "@/utils/analytics/extract-confidence";
import { CLASSIFICATION_PALETTE } from "@/utils/analytics/types";
import {
  computeLoadedDetectionJobIds,
  diffNewlyLoaded
} from "@/utils/auto-zoom";
import {
  webMercatorExtentToWGS84,
  webMercatorToWGS84,
  wgs84ExtentToWebMercator,
  wgs84ToWebMercator
} from "@/utils/coordinate-transformers-ol.ts";
import { createAuthenticatedTileLoader } from "@/utils/ol-tile-auth";

export default function MapViewer() {
  "use no memo";

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<OLMap | null>(null);
  const imageryLayers = useRef(new Map<string, TileLayer<XYZ>>());
  const detectionLayers = useRef(new Map<string, VectorLayer<VectorSource>>());
  const featuresLayer = useRef<VectorLayer<VectorSource> | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<FeatureLike | null>(
    null
  );
  const popupRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const stacItemCache = useRef<Map<string, StacItem>>(new Map());
  const renderedFeatures = useRef<Map<string, GeoJSONFeature>>(new Map());
  const stacTileLayers = useRef<Map<string, TileLayer<XYZ>>>(new Map());
  const dayNightLayer = useRef<VectorLayer<VectorSource> | null>(null);
  const prevVisibleJobIdsRef = useRef<Set<string>>(new Set());
  const prevVisibleFeatureIdsRef = useRef<Set<string>>(new Set());

  const dispatch = useAppDispatch();
  const viewport = useAppSelector((state) => state.viewport);
  const features = useAppSelector(
    (state) => state.overlay.inlineFeatures["agent-features"] ?? []
  );
  const overlayLayers = useAppSelector((state) => state.overlay.layers);
  const itemViewpoints = useAppSelector(selectItemViewpoints);
  const autoZoom = useAppSelector(selectAutoZoom);
  const mapSettings = useAppSelector(selectMapSettings);

  const { selectedJobs, layerStyles } = useAppSelector(
    (state) => state.jobs.selection
  );
  const viewpointData = useAppSelector(selectViewpointData);
  const confidenceThreshold = useAppSelector(
    (state) => state.analytics?.confidenceThreshold ?? 0
  );
  const colorMode = useAppSelector(
    (state) => state.analytics?.colorMode ?? "layer"
  );
  const layerOrder = useAppSelector((state) => state.overlay.layerOrder);

  // Stabilize layerStyles by content hash so the layer-update effect below
  // doesn't re-run on identity-only changes from Redux.
  const layerStylesRef = useRef(layerStyles);
  const layerStylesKey = JSON.stringify(layerStyles);
  const prevLayerStylesKey = useRef(layerStylesKey);
  if (prevLayerStylesKey.current !== layerStylesKey) {
    prevLayerStylesKey.current = layerStylesKey;
    layerStylesRef.current = layerStyles;
  }
  const stableLayerStyles = layerStylesRef.current;

  // Memoize visible item viewpoints to prevent re-renders when non-visible items change
  const visibleItemViewpoints = useMemo(() => {
    const visibleIds = new Set(
      features
        .filter((f) => f.properties.hasImagery)
        .map((f) => f.id.replace("stac-", ""))
    );

    return Object.fromEntries(
      Object.entries(itemViewpoints).filter(([id]) => visibleIds.has(id))
    );
  }, [features, itemViewpoints]);

  // Use shared authenticated tile loader from utils
  const authenticatedTileLoadFunction = () => createAuthenticatedTileLoader();

  // Initialize map
  useEffect(() => {
    if (!mapRef.current) return;

    const baseLayer = new TileLayer({
      source: new OSM()
    });

    // Create overlay for popup
    overlayRef.current = new Overlay({
      element: popupRef.current!,
      autoPan: {
        animation: {
          duration: 250
        }
      }
    } as OverlayOptions);

    // Initialize with current Redux viewport state
    const currentViewport = store.getState().viewport;

    const initialCenter = wgs84ToWebMercator({
      longitude: currentViewport.longitude,
      latitude: currentViewport.latitude
    });

    mapInstance.current = new OLMap({
      target: mapRef.current,
      layers: [baseLayer],
      overlays: [overlayRef.current],
      view: new View({
        center: [initialCenter.x, initialCenter.y],
        zoom: currentViewport.zoom,
        minZoom: 2,
        maxZoom: 19
      })
    });

    // If we have extent data from globe, fit to that extent for better correspondence
    if (currentViewport.lastUpdatedBy === "globe") {
      const webMercatorExtent = wgs84ExtentToWebMercator(
        currentViewport.extent
      );

      mapInstance.current.getView().fit(webMercatorExtent, {
        padding: [20, 20, 20, 20], // Minimal padding for tighter fit
        duration: 0 // No animation for initialization
      });
    }

    // Create features layer for agent-drawn features
    const featuresSource = new VectorSource();

    featuresLayer.current = new VectorLayer({
      source: featuresSource,
      style: (feature) => {
        const properties = feature.getProperties() as Record<string, unknown>;
        const style = (properties.style || {}) as FeatureStyle;
        const geometry = feature.getGeometry();
        const geometryType = geometry?.getType();

        // Convert hex colors to RGBA for opacity support
        const hexToRgba = (hex: string, opacity: number) => {
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);

          return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        };

        const fillColor = style.fillColor || "#3388ff";
        const strokeColor = style.color || "#3388ff";
        const fillOpacity =
          style.fillOpacity !== undefined ? style.fillOpacity : 0.2;
        const strokeOpacity = style.opacity !== undefined ? style.opacity : 0.8;
        const strokeWidth = style.weight || 3;

        // Enhanced styling for Point and MultiPoint geometries
        if (geometryType === "Point" || geometryType === "MultiPoint") {
          const pointRadius = style.radius || 8;

          // Check if custom icon is specified
          if (style.icon) {
            return new Style({
              image: new Icon({
                src: style.icon,
                scale: style.iconScale || 1,
                opacity: strokeOpacity
              })
            });
          }

          // Default to circle markers for points
          return new Style({
            image: new Circle({
              radius: pointRadius,
              fill: new Fill({
                color: hexToRgba(fillColor, fillOpacity)
              }),
              stroke: new Stroke({
                color: hexToRgba(strokeColor, strokeOpacity),
                width: strokeWidth
              })
            })
          });
        }

        // Default styling for polygons, lines, and other geometries
        return new Style({
          fill: new Fill({
            color: hexToRgba(fillColor, fillOpacity)
          }),
          stroke: new Stroke({
            color: hexToRgba(strokeColor, strokeOpacity),
            width: strokeWidth
          })
        });
      },
      zIndex: 100 // Ensure features are on top
    });

    mapInstance.current.addLayer(featuresLayer.current);

    // Add click handler
    mapInstance.current.on("click", (evt) => {
      const feature = mapInstance.current!.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => feature
      );

      if (feature) {
        setSelectedFeature(feature);
        overlayRef.current?.setPosition(evt.coordinate);

        // If this is an agent-drawn feature, update Redux selection.
        const featureId = feature.get("id") as string | undefined;
        const currentFeatures =
          store.getState().overlay.inlineFeatures["agent-features"] ?? [];

        if (featureId && currentFeatures.find((f) => f.id === featureId)) {
          dispatch(selectFeature(featureId));
        }
      } else {
        setSelectedFeature(null);
        overlayRef.current?.setPosition(undefined);
        dispatch(selectFeature(undefined));
      }
    });

    // Add viewport synchronization listeners
    let moveTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleMoveEnd = () => {
      // Debounce to prevent excessive updates
      if (moveTimeout) clearTimeout(moveTimeout);
      moveTimeout = setTimeout(() => {
        if (!mapInstance.current) return;

        const view = mapInstance.current.getView();

        // Get all three pieces of data directly from OpenLayers
        const center = view.getCenter();
        const zoom = view.getZoom() || 2;
        const extent = view.calculateExtent();

        if (center && extent) {
          const wgs84Center = webMercatorToWGS84({
            x: center[0],
            y: center[1]
          });
          const wgs84Extent = webMercatorExtentToWGS84(
            extent as [number, number, number, number]
          );

          dispatch(
            setViewport({
              longitude: wgs84Center.longitude,
              latitude: wgs84Center.latitude,
              zoom,
              extent: wgs84Extent,
              updatedBy: "map"
            })
          );
        }
      }, 300); // 300ms debounce
    };

    mapInstance.current.on("moveend", handleMoveEnd);

    return () => {
      if (moveTimeout) clearTimeout(moveTimeout);
      mapInstance.current?.setTarget(undefined);
      mapInstance.current = null;
    };
  }, [dispatch]);

  // Handle layer updates when overlay visibility, GeoJSON data, style, etc. changes
  useEffect(() => {
    if (!mapInstance.current) return;

    const cache = GeoJSONCacheService.getInstance();

    // Compute the set of job IDs with at least one overlay record present.
    // Each per-layer branch inside the loop below applies its own readiness
    // checks (detection.loading, viewpointEntry.loaded, etc.).
    const visibleJobIds = new Set<string>();
    for (const [, layer] of Object.entries(overlayLayers)) {
      if (
        (layer.source === "detection" || layer.id.startsWith("imagery-")) &&
        layer.metadata?.jobId
      ) {
        visibleJobIds.add(layer.metadata.jobId);
      }
    }

    // --- Imagery layers: add/remove based on overlay presence ---
    // Remove imagery layers for jobs whose overlay record is gone
    Array.from(imageryLayers.current.keys()).forEach((jobId) => {
      const imageryPresent = !!overlayLayers[`imagery-${jobId}`];
      if (!imageryPresent) {
        const layer = imageryLayers.current.get(jobId);
        if (layer) {
          mapInstance.current?.removeLayer(layer);
          imageryLayers.current.delete(jobId);
        }
      }
    });

    // Remove detection layers for jobs whose overlay record is gone
    Array.from(detectionLayers.current.keys()).forEach((jobId) => {
      const detectionPresent = !!overlayLayers[`detection-${jobId}`];
      if (!detectionPresent) {
        const layer = detectionLayers.current.get(jobId);
        if (layer) {
          mapInstance.current?.removeLayer(layer);
          detectionLayers.current.delete(jobId);
        }
      }
    });

    // Add or update layers for jobs present in the overlay
    visibleJobIds.forEach((jobId) => {
      const detectionLayerId = `detection-${jobId}`;
      const imageryLayerId = `imagery-${jobId}`;
      const detectionOverlay = overlayLayers[detectionLayerId];
      const imageryOverlay = overlayLayers[imageryLayerId];
      const cachedData = cache.get(detectionLayerId);
      const viewpointEntry = viewpointData[jobId];

      // Find the job object for metadata (name, etc.)
      const job = selectedJobs.find((j) => j.job_id === jobId) || {
        job_id: jobId,
        job_name: jobId,
        status: "SUCCESS"
      };

      // Handle imagery tile layer from viewpoint.
      // Presence of `imageryOverlay` in overlay.layers is the sole rendering
      // signal — the middleware removes the overlay record on deselection.
      if (
        imageryOverlay &&
        viewpointEntry?.loaded &&
        viewpointEntry.viewpoint.viewpoint_status === "READY" &&
        viewpointEntry.extent !== undefined &&
        !imageryLayers.current.has(jobId)
      ) {
        const extent = transformExtent(
          [
            viewpointEntry.extent.minLon,
            viewpointEntry.extent.minLat,
            viewpointEntry.extent.maxLon,
            viewpointEntry.extent.maxLat
          ],
          "EPSG:4326", // WGS84
          "EPSG:3857" // Web Mercator
        );
        const imageLayer = new TileLayer({
          source: new XYZ({
            url: `${siteConfig.tile_server_base_url}/latest/viewpoints/${viewpointEntry.viewpoint.viewpoint_id}/map/tiles/WebMercatorQuad/{z}/{y}/{x}.PNG?invert_y=true`,
            projection: "EPSG:3857", // Web Mercator
            tileLoadFunction: authenticatedTileLoadFunction()
          }),
          properties: {
            name: `${job.job_name || job.job_id}_image`,
            type: "image"
          },
          opacity: 1,
          zIndex: 1,
          extent: extent
        });

        imageryLayers.current.set(jobId, imageLayer);
        mapInstance.current?.addLayer(imageLayer);
      }

      // Handle detection GeoJSON layer — read from GeoJSONCacheService.
      // Presence of `detectionOverlay` in overlay.layers = should render.
      if (detectionOverlay) {
        const isLoaded =
          !detectionOverlay.metadata?.loading &&
          !detectionOverlay.metadata?.error;
        if (isLoaded && cachedData) {
          const layerStyle =
            stableLayerStyles[job.job_id] || DEFAULT_RESULT_STYLE;
          // Convert opacity to hex and concatenate it with the color
          const fillColor =
            layerStyle.color +
            Math.round(layerStyle.opacity * 255)
              .toString(16)
              .padStart(2, "0");

          // Style function that respects color mode and confidence threshold
          const classificationColors: Record<string, string> = {};
          const palette = CLASSIFICATION_PALETTE;
          let paletteIdx = 0;

          const styleFunction = (feature: FeatureLike) => {
            const props = feature.getProperties?.() ?? {};

            // Confidence threshold filtering (applies in all modes)
            if (confidenceThreshold > 0) {
              const conf = extractConfidence(props);
              if (conf !== undefined && conf < confidenceThreshold) {
                return new Style({}); // invisible
              }
            }

            // Color based on mode
            let featureFillColor = fillColor;
            let featureStrokeColor = layerStyle.color;

            if (colorMode === "confidence") {
              const conf = extractConfidence(props);
              if (conf !== undefined) {
                // Red-to-green gradient
                const r =
                  conf < 0.5 ? 255 : Math.round((1.0 - (conf - 0.5) * 2) * 255);
                const g = conf < 0.5 ? Math.round(conf * 2 * 255) : 255;
                const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}00`;
                featureStrokeColor = hex;
                featureFillColor =
                  hex +
                  Math.round(layerStyle.opacity * 255)
                    .toString(16)
                    .padStart(2, "0");
              } else {
                featureStrokeColor = "#808080";
                featureFillColor = "#80808040";
              }
            } else if (colorMode === "classification") {
              const cls = extractClassification(props);
              if (cls) {
                if (!classificationColors[cls]) {
                  classificationColors[cls] =
                    palette[paletteIdx % palette.length];
                  paletteIdx++;
                }
                featureStrokeColor = classificationColors[cls];
                featureFillColor =
                  classificationColors[cls] +
                  Math.round(layerStyle.opacity * 255)
                    .toString(16)
                    .padStart(2, "0");
              } else {
                featureStrokeColor = "#808080";
                featureFillColor = "#80808040";
              }
            }

            return new Style({
              fill: new Fill({ color: featureFillColor }),
              stroke: new Stroke({ color: featureStrokeColor, width: 2 })
            });
          };

          const existingVectorLayer = detectionLayers.current.get(jobId);

          if (existingVectorLayer) {
            existingVectorLayer.setStyle(styleFunction);
            existingVectorLayer.changed();
          } else {
            // Create new layer
            const vectorSource = new VectorSource({
              features: new GeoJSON().readFeatures(cachedData, {
                featureProjection: "EPSG:3857"
              })
            });

            const vectorLayer = new VectorLayer({
              source: vectorSource,
              properties: {
                name: `${job.job_name || job.job_id}_vectors`,
                type: "vector"
              },
              style: styleFunction,
              zIndex: 2
            });

            detectionLayers.current.set(jobId, vectorLayer);
            mapInstance.current?.addLayer(vectorLayer);
          }
        }
      }
    });

    // Auto-zoom should fire when a detection layer just became loaded —
    // not when it first appears in a loading state. Track the set of jobs
    // whose detection data is currently loaded; the diff against this is
    // what "newly ready" means.
    const loadedDetectionJobIds = computeLoadedDetectionJobIds(overlayLayers);
    const newlyVisible = diffNewlyLoaded(
      loadedDetectionJobIds,
      prevVisibleJobIdsRef.current
    );
    prevVisibleJobIdsRef.current = loadedDetectionJobIds;

    if (autoZoom && newlyVisible.size > 0) {
      // Zoom to the last newly visible job
      const targetJobId = Array.from(newlyVisible).pop()!;
      const vectorLayer = detectionLayers.current.get(targetJobId);
      if (vectorLayer) {
        const extent = vectorLayer.getSource()?.getExtent();
        if (
          extent &&
          extent.every((val) => isFinite(val)) &&
          extent[0] !== extent[2] &&
          extent[1] !== extent[3]
        ) {
          mapInstance.current?.getView().fit(extent, {
            padding: [50, 50, 50, 50],
            maxZoom: 16,
            duration: 1000
          });
        }
      }
    }

    // Handle setting layer order
    if (layerOrder.length > 0) {
      const layers = mapInstance.current.getLayers();

      // Remove all layers except base
      while (layers.getLength() > 1) {
        layers.removeAt(1);
      }
      // Add layers back in reverse order (top of list = top layer)
      [...layerOrder].reverse().forEach((entry) => {
        if (entry.startsWith("detection-")) {
          const jobId = entry.slice("detection-".length);
          const layer = detectionLayers.current.get(jobId);
          if (layer) {
            layers.push(layer);
          }
        } else if (entry.startsWith("imagery-")) {
          const jobId = entry.slice("imagery-".length);
          const layer = imageryLayers.current.get(jobId);
          if (layer) {
            layers.push(layer);
          }
        }
      });

      // Re-add the features layer (agent-drawn features) on top
      if (featuresLayer.current) {
        layers.push(featuresLayer.current);
      }

      // Re-add the day/night layer if active
      if (dayNightLayer.current) {
        layers.push(dayNightLayer.current);
      }
    }
  }, [
    selectedJobs,
    overlayLayers,
    viewpointData,
    stableLayerStyles,
    layerOrder,
    autoZoom,
    confidenceThreshold,
    colorMode
  ]);

  // Listen for agent-triggered viewport changes
  useEffect(() => {
    if (!mapInstance.current) return;
    if (viewport.lastUpdatedBy !== "agent") return;

    const view = mapInstance.current.getView();
    const center = wgs84ToWebMercator({
      longitude: viewport.longitude,
      latitude: viewport.latitude
    });

    // Animate to the new location
    view.animate({
      center: [center.x, center.y],
      zoom: viewport.zoom,
      duration: 1500 // 1.5 second animation
    });
  }, [viewport]);

  // Day/Night terminator layer
  useEffect(() => {
    if (!mapInstance.current) return;

    if (mapSettings.dayNightEnabled) {
      if (!dayNightLayer.current) {
        const source = new DayNight({});
        dayNightLayer.current = new VectorLayer({
          source: source as unknown as VectorSource,
          style: new Style({
            fill: new Fill({ color: "rgba(0, 0, 20, 0.35)" })
          }),
          zIndex: 99
        });
        mapInstance.current.addLayer(dayNightLayer.current);
      }

      // Update time and set up interval for real-time updates
      const src = dayNightLayer.current.getSource() as unknown as DayNight;
      src.setTime(new Date());

      const interval = setInterval(() => {
        const s =
          dayNightLayer.current?.getSource() as unknown as DayNight | null;
        s?.setTime(new Date());
      }, 60_000);

      return () => clearInterval(interval);
    } else if (dayNightLayer.current) {
      mapInstance.current.removeLayer(dayNightLayer.current);
      dayNightLayer.current = null;
    }
  }, [mapSettings.dayNightEnabled]);

  // Handle agent-drawn features rendering (HYBRID: Direct GeoJSON + STAC URLs + STAC Imagery)
  useEffect(() => {
    if (!mapInstance.current || !featuresLayer.current) return;

    const source = featuresLayer.current.getSource();

    if (!source) return;

    const currentFeatureIds = new Set(features.map((f) => f.id));
    const renderedFeatureIds = new Set(renderedFeatures.current.keys());

    const featuresToRemove = Array.from(renderedFeatureIds).filter(
      (id) => !currentFeatureIds.has(id)
    );
    const featuresToAdd = features.filter((f) => !renderedFeatureIds.has(f.id));

    featuresToRemove.forEach((featureId) => {
      const olFeature = source.getFeatureById(featureId);

      if (olFeature) {
        source.removeFeature(olFeature);
      }

      const tileLayer = stacTileLayers.current.get(featureId);

      if (tileLayer) {
        mapInstance.current?.removeLayer(tileLayer);
        stacTileLayers.current.delete(featureId);
      }

      renderedFeatures.current.delete(featureId);
    });

    const getCachedStacItem = async (
      collectionId: string,
      itemId: string
    ): Promise<StacItem> => {
      const cacheKey = `${collectionId}/${itemId}`;

      if (stacItemCache.current.has(cacheKey)) {
        return stacItemCache.current.get(cacheKey)!;
      }

      const item = await dataCatalogService.getItem(collectionId, itemId);

      stacItemCache.current.set(cacheKey, item);

      return item;
    };

    const processFeatures = async () => {
      for (const feature of featuresToAdd) {
        try {
          if (
            feature.properties.dataSource === "stac_url" &&
            feature.properties.stacUrl
          ) {
            // Extract collection and item ID from STAC URL
            const urlParts = feature.properties.stacUrl.split("/");
            const collectionIndex = urlParts.indexOf("collections");
            const itemsIndex = urlParts.indexOf("items");

            if (collectionIndex !== -1 && itemsIndex !== -1) {
              const collectionId = urlParts[collectionIndex + 1];
              const itemId = urlParts[itemsIndex + 1];

              try {
                const stacItem = await getCachedStacItem(collectionId, itemId);

                // Load the fetched STAC item (which is a valid GeoJSON Feature)
                const olFeatures = new GeoJSON().readFeatures(stacItem, {
                  featureProjection: "EPSG:3857", // Web Mercator
                  dataProjection: "EPSG:4326" // WGS84
                });

                // Handle both single feature and feature array results
                const featuresToAdd = Array.isArray(olFeatures)
                  ? olFeatures
                  : [olFeatures];

                featuresToAdd.forEach((olFeature) => {
                  // Set the feature ID for OpenLayers (needed for getFeatureById)
                  olFeature.setId(feature.id);

                  // Set feature properties for styling and interaction
                  olFeature.setProperties({
                    id: feature.id,
                    description: feature.properties.description,
                    style: feature.properties.style,
                    createdBy: feature.properties.createdBy,
                    stacUrl: feature.properties.stacUrl,
                    // Copy STAC properties for popup display
                    ...stacItem.properties
                  });

                  source.addFeature(olFeature);
                });

                renderedFeatures.current.set(feature.id, feature);
              } catch (error) {
                void error;
              }
            }
          } else {
            // Direct GeoJSON rendering (existing path for WKT/GeoJSON inputs)
            const olFeatures = new GeoJSON().readFeatures(feature, {
              featureProjection: "EPSG:3857", // Web Mercator
              dataProjection: "EPSG:4326" // WGS84
            });

            // Handle both single feature and feature array results
            const featuresToAdd = Array.isArray(olFeatures)
              ? olFeatures
              : [olFeatures];

            featuresToAdd.forEach((olFeature) => {
              // Set the feature ID for OpenLayers (needed for getFeatureById)
              olFeature.setId(feature.id);

              // Set feature properties for styling and interaction
              olFeature.setProperties({
                id: feature.id,
                description: feature.properties.description,
                style: feature.properties.style,
                createdBy: feature.properties.createdBy
              });

              source.addFeature(olFeature);
            });

            renderedFeatures.current.set(feature.id, feature);
          }
        } catch (error) {
          void error;
        }

        // Add STAC imagery tile layer if viewpoint is ready
        if (feature.properties.hasImagery && feature.properties.viewpointId) {
          const itemId = feature.id.replace("stac-", "");
          const viewpointState = visibleItemViewpoints[itemId];

          if (
            viewpointState?.status === "ready" &&
            viewpointState.viewpointId
          ) {
            // Get extent from rendered geometry
            const olFeature = source.getFeatureById(feature.id);

            if (olFeature) {
              const extent = olFeature.getGeometry()?.getExtent();

              if (extent) {
                const tileLayer = new TileLayer({
                  source: new XYZ({
                    url: `${siteConfig.tile_server_base_url}/latest/viewpoints/${viewpointState.viewpointId}/map/tiles/WebMercatorQuad/{z}/{y}/{x}.PNG?invert_y=true`,
                    projection: "EPSG:3857",
                    tileLoadFunction: authenticatedTileLoadFunction()
                  }),
                  properties: {
                    layerType: "stac-imagery",
                    featureId: feature.id,
                    viewpointId: viewpointState.viewpointId
                  },
                  extent: extent,
                  opacity: 0.8,
                  zIndex: 50
                });

                mapInstance.current?.addLayer(tileLayer);
                stacTileLayers.current.set(feature.id, tileLayer);
              }
            }
          }
        }

        renderedFeatures.current.set(feature.id, feature);
      }
    };

    // Call the async processing function
    processFeatures().then(() => {
      // Auto-zoom to newly visible STAC features (mirrors detection layer behavior)
      if (!autoZoom || !mapInstance.current) return;

      const currentFeatureIds = new Set(features.map((f) => f.id));
      const newlyVisibleFeatures = new Set<string>();
      currentFeatureIds.forEach((id) => {
        if (!prevVisibleFeatureIdsRef.current.has(id)) {
          newlyVisibleFeatures.add(id);
        }
      });
      prevVisibleFeatureIdsRef.current = currentFeatureIds;

      if (newlyVisibleFeatures.size > 0) {
        const targetId = Array.from(newlyVisibleFeatures).pop()!;
        const olFeature = source.getFeatureById(targetId);
        if (olFeature) {
          const extent = olFeature.getGeometry()?.getExtent();
          if (
            extent &&
            extent.every((val) => isFinite(val)) &&
            extent[0] !== extent[2] &&
            extent[1] !== extent[3]
          ) {
            mapInstance.current?.getView().fit(extent, {
              padding: [50, 50, 50, 50],
              maxZoom: 16,
              duration: 1000
            });
          }
        }
      }
    });
  }, [features, visibleItemViewpoints, autoZoom]);

  return (
    <>
      <div ref={mapRef} className="w-full h-full" />
      <div ref={popupRef} className="ol-popup">
        {selectedFeature && (
          <FeaturePopup
            feature={selectedFeature}
            onClose={() => {
              setSelectedFeature(null);
              overlayRef.current?.setPosition(undefined);
            }}
          />
        )}
      </div>
    </>
  );
}
