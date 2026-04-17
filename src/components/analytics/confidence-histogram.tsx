// Copyright Amazon.com, Inc. or its affiliates.
import React from "react";

interface ConfidenceHistogramProps {
  bins: number[];
  activeBins: Set<number>;
  onBinClick: (index: number) => void;
}

/** Interpolate from red (bin 0) to green (bin 9). */
function binColor(index: number): string {
  const t = index / 9;
  const r = Math.round(220 * (1 - t));
  const g = Math.round(200 * t);
  const b = 40;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

const SVG_WIDTH = 200;
const SVG_HEIGHT = 100;
const BAR_GAP = 2;
const BAR_WIDTH = (SVG_WIDTH - BAR_GAP * 9) / 10;

export const ConfidenceHistogram: React.FC<ConfidenceHistogramProps> = ({
  bins,
  activeBins,
  onBinClick
}) => {
  const allZero = bins.every((b) => b === 0);

  if (allZero) {
    return (
      <div
        style={{
          width: SVG_WIDTH,
          height: SVG_HEIGHT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#888"
        }}
      >
        No data
      </div>
    );
  }

  const maxBin = Math.max(...bins, 1);

  return (
    <svg
      width={SVG_WIDTH}
      height={SVG_HEIGHT}
      role="img"
      aria-label="Confidence histogram"
    >
      {bins.map((count, i) => {
        const barHeight = (count / maxBin) * (SVG_HEIGHT - 4);
        const x = i * (BAR_WIDTH + BAR_GAP);
        const y = SVG_HEIGHT - barHeight;
        const isActive = activeBins.has(i);
        return (
          <rect
            key={i}
            data-bin={i}
            x={x}
            y={y}
            width={BAR_WIDTH}
            height={barHeight}
            fill={binColor(i)}
            stroke={isActive ? "white" : "none"}
            strokeWidth={isActive ? 2 : 0}
            style={{ cursor: "pointer" }}
            onClick={() => onBinClick(i)}
          />
        );
      })}
    </svg>
  );
};
