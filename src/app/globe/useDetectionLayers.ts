// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Renders detection GeoJSON layers on the Cesium globe using diff-based
 * reconciliation against `state.overlay.layers`.
 *
 * Each detection layer's GeoJSON is parsed/loaded exactly once (when the layer
 * first becomes ready) and tracked in a ref. On color-mode, confidence-
 * threshold, or per-layer-style changes the existing entities are simply
 * re-styled in place — the GeoJSON is never re-parsed and the whole data-source
 * collection is never torn down (the previous `dataSources.removeAll()` +
 * rebuild caused flicker and a full re-parse on every slider move).
 *
 * Presence of a `detection-<jobId>` record in `overlay.layers` is the sole
 * rendering signal; the jobs-slice middleware manages that record. Auto-zoom
 * fires when a detection layer's data first finishes loading.
 */
import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  GeoJsonDataSource,
  Math as CesiumMath,
  type Viewer as CesiumViewer
} from "cesium";
import { useEffect, useRef } from "react";

import { applyEntityStyling } from "@/app/globe/cesium-entity-styling";
import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import { useAppSelector } from "@/store/hooks.ts";
import {
  DEFAULT_RESULT_STYLE,
  selectLayerStyles,
  VectorStyle
} from "@/store/slices/jobs-slice.ts";
import { selectAutoZoom } from "@/store/slices/settings-slice.ts";
import { CLASSIFICATION_PALETTE } from "@/utils/analytics/types";
import {
  computeLoadedDetectionJobIds,
  diffNewlyLoaded
} from "@/utils/auto-zoom";
import {
  getFeatureDisplayColor,
  isBelowConfidenceThreshold,
  makeClassificationColorResolver
} from "@/utils/map-rendering";

/** Fly the camera to fit a detection data source's entities (nadir view). */
function flyToDetection(viewer: CesiumViewer, dataSource: GeoJsonDataSource) {
  const entities = dataSource.entities.values;
  if (entities.length === 0) return;

  const centroids: Cartesian3[] = [];
  for (const entity of entities) {
    const pos = entity.position?.getValue(viewer.clock.currentTime) as
      | Cartesian3
      | undefined;
    if (pos) {
      centroids.push(pos);
      continue;
    }
    const hierarchy = entity.polygon?.hierarchy?.getValue(
      viewer.clock.currentTime
    ) as { positions: Cartesian3[] } | undefined;
    if (hierarchy?.positions && hierarchy.positions.length > 0) {
      const pts = hierarchy.positions;
      const sum = pts.reduce(
        (acc, p) => new Cartesian3(acc.x + p.x, acc.y + p.y, acc.z + p.z),
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
    const linePositions = entity.polyline?.positions?.getValue(
      viewer.clock.currentTime
    ) as Cartesian3[] | undefined;
    if (linePositions && linePositions.length > 0) {
      const sum = linePositions.reduce(
        (acc, p) => new Cartesian3(acc.x + p.x, acc.y + p.y, acc.z + p.z),
        new Cartesian3(0, 0, 0)
      );
      centroids.push(
        new Cartesian3(
          sum.x / linePositions.length,
          sum.y / linePositions.length,
          sum.z / linePositions.length
        )
      );
    }
  }

  if (centroids.length > 0) {
    const sphere = BoundingSphere.fromPoints(centroids);
    const center = Cartographic.fromCartesian(sphere.center);
    const height = Math.max(sphere.radius * 3, 5000);
    viewer.camera.flyTo({
      destination: Cartesian3.fromRadians(
        center.longitude,
        center.latitude,
        height
      ),
      orientation: {
        heading: 0,
        pitch: CesiumMath.toRadians(-90), // straight down (nadir)
        roll: 0
      },
      duration: 1.5
    });
  } else {
    // Fallback when positions can't be extracted
    viewer.flyTo(dataSource, { duration: 1.5 });
  }
}

export function useDetectionLayers(
  viewer: CesiumViewer | null,
  viewerReady: boolean
): void {
  const overlayLayers = useAppSelector((state) => state.overlay.layers);
  const layerOrder = useAppSelector((state) => state.overlay.layerOrder);
  const layerStyles = useAppSelector(selectLayerStyles);
  const autoZoom = useAppSelector(selectAutoZoom);
  const confidenceThreshold = useAppSelector(
    (state) => state.analytics?.confidenceThreshold ?? 0
  );
  const colorMode = useAppSelector(
    (state) => state.analytics?.colorMode ?? "layer"
  );

  // Detection data sources keyed by overlay layer id (`detection-<jobId>`).
  const sourcesRef = useRef<Map<string, GeoJsonDataSource>>(new Map());
  // Jobs whose detection data was loaded as of the previous render, used to
  // detect "newly ready" layers for auto-zoom.
  const prevVisibleJobIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!viewer || viewer.isDestroyed?.() || !viewerReady) return;

    const cache = GeoJSONCacheService.getInstance();
    const sources = sourcesRef.current;

    // (Re)apply color + visibility to a source's entities. Cheap relative to
    // re-parsing GeoJSON, so this runs on every style/mode/threshold change.
    const styleEntities = (
      dataSource: GeoJsonDataSource,
      jobId: string | undefined,
      jobStyle: VectorStyle
    ) => {
      const classificationColor = makeClassificationColorResolver(
        CLASSIFICATION_PALETTE
      );
      dataSource.entities.values.forEach((entity) => {
        entity.name = `${jobId}::${entity.id}`;
        const props = entity.properties?.getValue(viewer.clock.currentTime) as
          | Record<string, unknown>
          | undefined;
        const color = props
          ? getFeatureDisplayColor(
              props,
              colorMode,
              jobStyle.color,
              classificationColor
            )
          : jobStyle.color;

        applyEntityStyling(entity, {
          fillColor: color,
          color,
          fillOpacity: jobStyle.opacity * 0.6,
          opacity: jobStyle.opacity,
          weight: 2
        });

        if (entity.polygon || entity.polyline) {
          entity.billboard = undefined;
          entity.point = undefined;
        }

        entity.show = !(
          props && isBelowConfidenceThreshold(props, confidenceThreshold)
        );
      });
    };

    // Reconcile: create+load new sources, re-style existing ones in place.
    const renderableIds = new Set<string>();
    const dsByJobId = new Map<string, GeoJsonDataSource>();
    const newLoadByJobId = new Map<string, Promise<void>>();

    for (const layerId of layerOrder) {
      const layer = overlayLayers[layerId];
      if (!layer || layer.source !== "detection") continue;
      if (layer.metadata?.loading || layer.metadata?.error) continue;
      const geoJsonData = cache.get(layerId);
      if (!geoJsonData) continue;

      renderableIds.add(layerId);
      const jobId = layer.metadata?.jobId;
      const jobStyle = (jobId && layerStyles[jobId]) || DEFAULT_RESULT_STYLE;

      const existing = sources.get(layerId);
      if (existing) {
        styleEntities(existing, jobId, jobStyle);
        if (jobId) dsByJobId.set(jobId, existing);
      } else {
        const dataSource = new GeoJsonDataSource(layerId);
        sources.set(layerId, dataSource);
        const loadPromise = dataSource
          .load(geoJsonData)
          .then(() => styleEntities(dataSource, jobId, jobStyle));
        viewer.dataSources.add(dataSource);
        if (jobId) {
          dsByJobId.set(jobId, dataSource);
          newLoadByJobId.set(jobId, loadPromise);
        }
      }
    }

    // Remove sources whose detection layer is no longer renderable.
    Array.from(sources.entries()).forEach(([layerId, dataSource]) => {
      if (!renderableIds.has(layerId)) {
        viewer.dataSources.remove(dataSource);
        sources.delete(layerId);
      }
    });

    // Auto-zoom when a detection layer's data just finished loading.
    const currentVisible = computeLoadedDetectionJobIds(overlayLayers);
    const newlyVisible = Array.from(
      diffNewlyLoaded(currentVisible, prevVisibleJobIdsRef.current)
    );
    prevVisibleJobIdsRef.current = currentVisible;

    if (autoZoom && newlyVisible.length > 0) {
      const targetJobId = newlyVisible[newlyVisible.length - 1];
      const dataSource = dsByJobId.get(targetJobId);
      if (dataSource) {
        const ready = newLoadByJobId.get(targetJobId) ?? Promise.resolve();
        ready.then(() => {
          if (!viewer.isDestroyed?.()) flyToDetection(viewer, dataSource);
        });
      }
    }
  }, [
    viewer,
    viewerReady,
    overlayLayers,
    layerOrder,
    layerStyles,
    autoZoom,
    confidenceThreshold,
    colorMode
  ]);
}
