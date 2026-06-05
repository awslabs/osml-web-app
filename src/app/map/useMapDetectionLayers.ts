// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Renders detection GeoJSON layers on the OpenLayers 2D map using diff-based
 * reconciliation against `state.overlay.layers`. This mirrors the Cesium
 * globe's `useDetectionLayers`.
 *
 * Each detection layer's GeoJSON is parsed exactly once (when the layer first
 * becomes ready) and tracked in `detectionLayers`. On color-mode, confidence-
 * threshold, or per-layer-style changes the existing layer is simply re-styled
 * in place — the GeoJSON is never re-parsed. Pulling this out of the map
 * component's combined layer effect also stops detection style functions from
 * being recreated on unrelated overlay churn (imagery loading, layer order).
 *
 * Presence of a `detection-<jobId>` record in `overlay.layers` is the sole
 * rendering signal; the jobs-slice middleware manages that record. Auto-zoom
 * fires (when Redux `autoZoom` is enabled) as a detection layer's data first
 * finishes loading.
 *
 * `mapInstance` and `detectionLayers` are owned by the map component and passed
 * in so the component's layer-ordering logic continues to see the same refs.
 */
import type { FeatureLike } from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import VectorLayer from "ol/layer/Vector";
import { default as OLMap } from "ol/Map";
import VectorSource from "ol/source/Vector";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import { RefObject, useEffect, useRef } from "react";

import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import { useAppSelector } from "@/store/hooks.ts";
import {
  DEFAULT_RESULT_STYLE,
  selectLayerStyles
} from "@/store/slices/jobs-slice.ts";
import { selectAutoZoom } from "@/store/slices/settings-slice.ts";
import { CLASSIFICATION_PALETTE } from "@/utils/analytics/types";
import {
  computeLoadedDetectionJobIds,
  diffNewlyLoaded
} from "@/utils/auto-zoom";
import { hexWithAlpha } from "@/utils/color-utils";
import {
  getFeatureDisplayColor,
  isBelowConfidenceThreshold,
  makeClassificationColorResolver,
  MISSING_DATA_COLOR
} from "@/utils/map-rendering";

export function useMapDetectionLayers(
  mapInstance: RefObject<OLMap | null>,
  detectionLayers: RefObject<Map<string, VectorLayer<VectorSource>>>
): void {
  const overlayLayers = useAppSelector((state) => state.overlay.layers);
  const selectedJobs = useAppSelector(
    (state) => state.jobs.selection.selectedJobs
  );
  const layerStyles = useAppSelector(selectLayerStyles);
  const autoZoom = useAppSelector(selectAutoZoom);
  const confidenceThreshold = useAppSelector(
    (state) => state.analytics?.confidenceThreshold ?? 0
  );
  const colorMode = useAppSelector(
    (state) => state.analytics?.colorMode ?? "layer"
  );

  // Jobs whose detection data was loaded as of the previous render, used to
  // detect "newly ready" layers for auto-zoom.
  const prevVisibleJobIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!mapInstance.current) return;

    const cache = GeoJSONCacheService.getInstance();

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

    // Detection job IDs present in the overlay. Imagery layers share the
    // "detection" source type but are rendered by the imagery effect; the
    // per-job branch below self-guards on the `detection-<jobId>` record.
    const visibleJobIds = new Set<string>();
    for (const [, layer] of Object.entries(overlayLayers)) {
      if (
        (layer.source === "detection" || layer.id.startsWith("imagery-")) &&
        layer.metadata?.jobId
      ) {
        visibleJobIds.add(layer.metadata.jobId);
      }
    }

    visibleJobIds.forEach((jobId) => {
      const detectionLayerId = `detection-${jobId}`;
      const detectionOverlay = overlayLayers[detectionLayerId];
      const cachedData = cache.get(detectionLayerId);

      // Find the job object for metadata (name, etc.)
      const job = selectedJobs.find((j) => j.job_id === jobId) || {
        job_id: jobId,
        job_name: jobId,
        status: "SUCCESS"
      };

      // Handle detection GeoJSON layer — read from GeoJSONCacheService.
      // Presence of `detectionOverlay` in overlay.layers = should render.
      if (detectionOverlay) {
        const isLoaded =
          !detectionOverlay.metadata?.loading &&
          !detectionOverlay.metadata?.error;
        if (isLoaded && cachedData) {
          const layerStyle = layerStyles[job.job_id] || DEFAULT_RESULT_STYLE;

          // Style function that respects color mode and confidence threshold.
          // One classification resolver per layer keeps color assignment stable.
          const classificationColor = makeClassificationColorResolver(
            CLASSIFICATION_PALETTE
          );

          const styleFunction = (feature: FeatureLike) => {
            const props = feature.getProperties?.() ?? {};

            // Confidence threshold filtering (applies in all modes)
            if (isBelowConfidenceThreshold(props, confidenceThreshold)) {
              return new Style({}); // invisible
            }

            const strokeColor = getFeatureDisplayColor(
              props,
              colorMode,
              layerStyle.color,
              classificationColor
            );
            // Missing-data features keep the legacy fixed-alpha gray fill;
            // all other colors use the layer's configured opacity.
            const fillColor =
              strokeColor === MISSING_DATA_COLOR
                ? `${MISSING_DATA_COLOR}40`
                : hexWithAlpha(strokeColor, layerStyle.opacity);

            return new Style({
              fill: new Fill({ color: fillColor }),
              stroke: new Stroke({ color: strokeColor, width: 2 })
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
  }, [
    mapInstance,
    detectionLayers,
    overlayLayers,
    selectedJobs,
    layerStyles,
    autoZoom,
    confidenceThreshold,
    colorMode
  ]);
}
