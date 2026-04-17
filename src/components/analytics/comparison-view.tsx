// Copyright Amazon.com, Inc. or its affiliates.
import React from "react";

import type { ComparisonResult, LayerStats } from "@/utils/analytics/types";

interface ComparisonViewProps {
  layerA: LayerStats;
  layerB: LayerStats;
  comparisonResult: ComparisonResult | null;
}

/** Return the classification with the highest count, or "N/A". */
function topClassification(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "N/A";
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/** Return the top N classifications sorted by count descending. */
function topN(counts: Record<string, number>, n: number): [string, number][] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function formatConfidence(avg: number | undefined): string {
  if (avg === undefined) return "N/A";
  return `${Math.round(avg * 100)}%`;
}

const cellStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderBottom: "1px solid #444",
  fontSize: 13
};

const headerStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  color: "#aaa"
};

export const ComparisonView: React.FC<ComparisonViewProps> = ({
  layerA,
  layerB,
  comparisonResult
}) => {
  if (!layerA || !layerB) return null;

  const topA = topN(layerA.classificationCounts, 3);
  const topB = topN(layerB.classificationCounts, 3);
  const maxRows = Math.max(topA.length, topB.length, 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Stats table */}
      <table
        style={{ width: "100%", borderCollapse: "collapse", color: "#fff" }}
      >
        <thead>
          <tr>
            <th style={headerStyle}>Metric</th>
            <th style={headerStyle}>Layer A</th>
            <th style={headerStyle}>Layer B</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cellStyle}>Total Detections</td>
            <td style={cellStyle}>{layerA.totalCount}</td>
            <td style={cellStyle}>{layerB.totalCount}</td>
          </tr>
          <tr>
            <td style={cellStyle}>Avg Confidence</td>
            <td style={cellStyle}>{formatConfidence(layerA.avgConfidence)}</td>
            <td style={cellStyle}>{formatConfidence(layerB.avgConfidence)}</td>
          </tr>
          <tr>
            <td style={cellStyle}>Top Classification</td>
            <td style={cellStyle}>
              {topClassification(layerA.classificationCounts)}
            </td>
            <td style={cellStyle}>
              {topClassification(layerB.classificationCounts)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Classification breakdown */}
      <div>
        <div
          style={{
            fontSize: 12,
            color: "#aaa",
            marginBottom: 4,
            fontWeight: 600
          }}
        >
          Classification Breakdown (Top 3)
        </div>
        <table
          style={{ width: "100%", borderCollapse: "collapse", color: "#fff" }}
        >
          <thead>
            <tr>
              <th style={headerStyle}>Layer A</th>
              <th style={headerStyle}>Layer B</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRows }).map((_, i) => (
              <tr key={i}>
                <td style={cellStyle}>
                  {topA[i] ? `${topA[i][0]} (${topA[i][1]})` : "—"}
                </td>
                <td style={cellStyle}>
                  {topB[i] ? `${topB[i][0]} (${topB[i][1]})` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Overlap summary */}
      {comparisonResult && (
        <div>
          <div
            style={{
              fontSize: 12,
              color: "#aaa",
              marginBottom: 4,
              fontWeight: 600
            }}
          >
            Overlap Summary
          </div>
          <table
            style={{ width: "100%", borderCollapse: "collapse", color: "#fff" }}
          >
            <tbody>
              <tr>
                <td style={cellStyle}>Unique to Layer A</td>
                <td style={cellStyle}>{comparisonResult.uniqueToA.length}</td>
              </tr>
              <tr>
                <td style={cellStyle}>Unique to Layer B</td>
                <td style={cellStyle}>{comparisonResult.uniqueToB.length}</td>
              </tr>
              <tr>
                <td style={cellStyle}>Overlapping Pairs</td>
                <td style={cellStyle}>{comparisonResult.overlapping.length}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
