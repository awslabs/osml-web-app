// Copyright Amazon.com, Inc. or its affiliates.
import React, { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";

import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import { toggleLayerSelection } from "@/store/slices/analytics-slice";
import type { OverlayLayer } from "@/store/slices/overlay-slice";
import type { RootState } from "@/store/store";
import { computeLayerStats } from "@/utils/analytics/compute-layer-stats";
import { extractFeatureRecords } from "@/utils/analytics/extract-feature-records";
import type { LayerStats } from "@/utils/analytics/types";

import { ClassificationChart } from "./classification-chart";
import { ColorModeSelector } from "./color-mode-selector";
import { ComparisonView } from "./comparison-view";
import { ConfidenceHistogram } from "./confidence-histogram";
import { ConfidenceSlider } from "./confidence-slider";
import { FilterChips } from "./filter-chips";

export const AnalyticsPanel: React.FC = () => {
  const dispatch = useDispatch();
  const cache = GeoJSONCacheService.getInstance();

  const layers = useSelector((state: RootState) => state.overlay.layers);
  const layerOrder = useSelector(
    (state: RootState) => state.overlay.layerOrder
  );
  const jobs = useSelector(
    (state: RootState) => state.jobs?.jobsList?.jobs ?? []
  );
  const selectedLayerIds = useSelector(
    (state: RootState) => state.analytics.selectedLayerIds
  );
  const confidenceThreshold = useSelector(
    (state: RootState) => state.analytics.confidenceThreshold
  );
  const activeFilters = useSelector(
    (state: RootState) => state.analytics.activeFilters
  );

  // Only show detection GeoJSON layers (not imagery tile layers).
  // Presence in overlay.layers = the layer is currently rendered; the
  // jobs-slice middleware removes entries on deselection/deletion.
  const detectionLayers: OverlayLayer[] = useMemo(() => {
    return layerOrder
      .map((id) => layers[id])
      .filter(
        (l): l is OverlayLayer =>
          !!l && l.source === "detection" && l.metadata?.layerType === "vector"
      );
  }, [layers, layerOrder]);

  // Build a jobId → job_name lookup from the jobs list
  const jobNameMap: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    for (const job of jobs) {
      if (job.job_name) {
        map[job.job_id] = job.job_name;
      }
    }
    return map;
  }, [jobs]);

  const layerStatsMap: Record<string, LayerStats> = useMemo(() => {
    const result: Record<string, LayerStats> = {};
    for (const layer of detectionLayers) {
      const records = extractFeatureRecords(layer.id, cache);
      result[layer.id] = computeLayerStats(records, confidenceThreshold);
    }
    return result;
  }, [cache, detectionLayers, confidenceThreshold]);

  const activeBins = useMemo(() => {
    const bins = new Set<number>();
    for (const f of activeFilters) {
      if (f.type === "confidence-range" && typeof f.value === "object") {
        const { min } = f.value as { min: number; max: number };
        bins.add(Math.min(Math.floor(min * 10), 9));
      }
    }
    return bins;
  }, [activeFilters]);

  const activeLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const f of activeFilters) {
      if (f.type === "classification" && typeof f.value === "string") {
        labels.add(f.value);
      }
    }
    return labels;
  }, [activeFilters]);

  if (detectionLayers.length === 0) {
    return (
      <div style={{ padding: 16, color: "#888", textAlign: "center" }}>
        Load detection data to view analytics.
      </div>
    );
  }

  const showComparison =
    selectedLayerIds.length === 2 &&
    layerStatsMap[selectedLayerIds[0]] &&
    layerStatsMap[selectedLayerIds[1]];

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 12, padding: 8 }}
    >
      <ColorModeSelector />
      <ConfidenceSlider />
      <FilterChips />

      {detectionLayers.map((layer) => {
        const stats = layerStatsMap[layer.id];
        if (!stats) return null;

        return (
          <div
            key={layer.id}
            style={{
              border: "1px solid #444",
              borderRadius: 8,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <div>
                <div style={{ fontWeight: 600, color: "#fff" }}>
                  {(layer.metadata?.jobId &&
                    jobNameMap[layer.metadata.jobId]) ||
                    layer.name}
                </div>
                <div style={{ fontSize: 12, color: "#aaa" }}>
                  {stats.totalCount} features ({stats.visibleCount} visible)
                </div>
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  color: "#ccc"
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedLayerIds.includes(layer.id)}
                  onChange={() => dispatch(toggleLayerSelection(layer.id))}
                />
                Compare
              </label>
            </div>

            <ConfidenceHistogram
              bins={stats.confidenceHistogram}
              activeBins={activeBins}
              onBinClick={() => {}}
            />

            <ClassificationChart
              counts={stats.classificationCounts}
              activeLabels={activeLabels}
              onLabelClick={() => {}}
            />
          </div>
        );
      })}

      {showComparison && (
        <ComparisonView
          layerA={layerStatsMap[selectedLayerIds[0]]}
          layerB={layerStatsMap[selectedLayerIds[1]]}
          comparisonResult={null}
        />
      )}
    </div>
  );
};
