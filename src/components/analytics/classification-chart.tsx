// Copyright Amazon.com, Inc. or its affiliates.
import React from "react";

import { CLASSIFICATION_PALETTE } from "@/utils/analytics/types";

interface ClassificationChartProps {
  counts: Record<string, number>;
  activeLabels: Set<string>;
  onLabelClick: (label: string) => void;
}

const PALETTE = CLASSIFICATION_PALETTE;

const SVG_WIDTH = 200;
const BAR_HEIGHT = 20;
const MAX_LEGEND = 5;

export const ClassificationChart: React.FC<ClassificationChartProps> = ({
  counts,
  activeLabels,
  onLabelClick
}) => {
  const labels = Object.keys(counts);

  if (labels.length === 0) {
    return (
      <div
        style={{
          width: SVG_WIDTH,
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#888"
        }}
      >
        No classifications
      </div>
    );
  }

  // Sort labels by count descending for consistent ordering
  const sorted = [...labels].sort((a, b) => counts[b] - counts[a]);
  const total = sorted.reduce((sum, l) => sum + counts[l], 0);

  // Build segments
  let xOffset = 0;
  const segments = sorted.map((label, i) => {
    const width = (counts[label] / total) * SVG_WIDTH;
    const seg = {
      label,
      x: xOffset,
      width,
      color: PALETTE[i % PALETTE.length]
    };
    xOffset += width;
    return seg;
  });

  const legendLabels = sorted.slice(0, MAX_LEGEND);
  const overflow = sorted.length - MAX_LEGEND;

  return (
    <div>
      <svg
        width={SVG_WIDTH}
        height={BAR_HEIGHT}
        role="img"
        aria-label="Classification chart"
      >
        {segments.map((seg) => {
          const isActive = activeLabels.has(seg.label);
          return (
            <rect
              key={seg.label}
              data-label={seg.label}
              x={seg.x}
              y={0}
              width={seg.width}
              height={BAR_HEIGHT}
              fill={seg.color}
              stroke={isActive ? "white" : "none"}
              strokeWidth={isActive ? 2 : 0}
              style={{ cursor: "pointer" }}
              onClick={() => onLabelClick(seg.label)}
            />
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 4,
          fontSize: 12
        }}
      >
        {legendLabels.map((label, i) => (
          <span
            key={label}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: PALETTE[i % PALETTE.length],
                display: "inline-block"
              }}
            />
            {label}
          </span>
        ))}
        {overflow > 0 && <span>+{overflow} more</span>}
      </div>
    </div>
  );
};
