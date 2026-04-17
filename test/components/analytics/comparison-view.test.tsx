// Copyright Amazon.com, Inc. or its affiliates.
import { render, screen } from "@testing-library/react";
import React from "react";

import { ComparisonView } from "@/components/analytics/comparison-view";
import type { ComparisonResult, LayerStats } from "@/utils/analytics/types";

function makeLayerStats(overrides: Partial<LayerStats> = {}): LayerStats {
  return {
    totalCount: 10,
    visibleCount: 8,
    classificationCounts: { building: 5, vehicle: 3, tree: 2 },
    confidenceHistogram: [0, 0, 0, 1, 2, 2, 2, 1, 1, 1],
    avgConfidence: 0.65,
    unknownConfidenceCount: 0,
    unclassifiedCount: 0,
    ...overrides
  };
}

describe("ComparisonView", () => {
  it("renders a stats table when provided with two layer stats", () => {
    const layerA = makeLayerStats({ totalCount: 20, avgConfidence: 0.8 });
    const layerB = makeLayerStats({ totalCount: 15, avgConfidence: 0.6 });
    render(
      <ComparisonView layerA={layerA} layerB={layerB} comparisonResult={null} />
    );
    // Should show total detections for both layers
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("renders nothing when layerA or layerB is not provided", () => {
    const { container } = render(
      <ComparisonView
        layerA={undefined as unknown as LayerStats}
        layerB={undefined as unknown as LayerStats}
        comparisonResult={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows overlap summary when comparisonResult is provided", () => {
    const layerA = makeLayerStats();
    const layerB = makeLayerStats();
    const comparisonResult: ComparisonResult = {
      uniqueToA: ["f1", "f2", "f3"],
      uniqueToB: ["f4"],
      overlapping: [
        { featureIdA: "f5", featureIdB: "f6" },
        { featureIdA: "f7", featureIdB: "f8" }
      ]
    };
    render(
      <ComparisonView
        layerA={layerA}
        layerB={layerB}
        comparisonResult={comparisonResult}
      />
    );
    // Should display unique-to-A count, unique-to-B count, overlapping pairs count
    expect(screen.getByText("3")).toBeInTheDocument(); // uniqueToA
    expect(screen.getByText("1")).toBeInTheDocument(); // uniqueToB
    expect(screen.getByText("2")).toBeInTheDocument(); // overlapping
  });
});
