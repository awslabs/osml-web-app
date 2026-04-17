// Copyright Amazon.com, Inc. or its affiliates.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { ClassificationChart } from "@/components/analytics/classification-chart";

describe("ClassificationChart", () => {
  const sampleCounts: Record<string, number> = {
    building: 40,
    vehicle: 30,
    tree: 20,
    road: 10
  };

  it("renders proportional segments for each classification", () => {
    const { container } = render(
      <ClassificationChart
        counts={sampleCounts}
        activeLabels={new Set()}
        onLabelClick={jest.fn()}
      />
    );
    const segments = container.querySelectorAll("rect[data-label]");
    expect(segments.length).toBe(4);
    // Widths should be proportional: building > vehicle > tree > road
    const widths = Array.from(segments).map((s) =>
      parseFloat(s.getAttribute("width") ?? "0")
    );
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
    expect(widths[2]).toBeGreaterThan(widths[3]);
  });

  it("renders legend with up to 5 labels and '+N more' for overflow", () => {
    const manyCounts: Record<string, number> = {
      building: 10,
      vehicle: 9,
      tree: 8,
      road: 7,
      water: 6,
      bridge: 5,
      fence: 4
    };
    render(
      <ClassificationChart
        counts={manyCounts}
        activeLabels={new Set()}
        onLabelClick={jest.fn()}
      />
    );
    // Should show 5 labels in legend
    expect(screen.getByText("building")).toBeInTheDocument();
    expect(screen.getByText("vehicle")).toBeInTheDocument();
    expect(screen.getByText("tree")).toBeInTheDocument();
    expect(screen.getByText("road")).toBeInTheDocument();
    expect(screen.getByText("water")).toBeInTheDocument();
    // Should show "+2 more"
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("fires onLabelClick with the classification label when a segment is clicked", () => {
    const onLabelClick = jest.fn();
    const { container } = render(
      <ClassificationChart
        counts={sampleCounts}
        activeLabels={new Set()}
        onLabelClick={onLabelClick}
      />
    );
    const segments = container.querySelectorAll("rect[data-label]");
    const buildingSegment = Array.from(segments).find(
      (s) => s.getAttribute("data-label") === "building"
    );
    expect(buildingSegment).toBeDefined();
    fireEvent.click(buildingSegment!);
    expect(onLabelClick).toHaveBeenCalledWith("building");
  });

  it("renders a white border on active label segments", () => {
    const activeLabels = new Set(["vehicle"]);
    const { container } = render(
      <ClassificationChart
        counts={sampleCounts}
        activeLabels={activeLabels}
        onLabelClick={jest.fn()}
      />
    );
    const segments = container.querySelectorAll("rect[data-label]");
    const vehicleSegment = Array.from(segments).find(
      (s) => s.getAttribute("data-label") === "vehicle"
    );
    const buildingSegment = Array.from(segments).find(
      (s) => s.getAttribute("data-label") === "building"
    );
    expect(vehicleSegment?.getAttribute("stroke")).toBe("white");
    expect(buildingSegment?.getAttribute("stroke")).not.toBe("white");
  });

  it('displays "No classifications" placeholder when counts are empty', () => {
    render(
      <ClassificationChart
        counts={{}}
        activeLabels={new Set()}
        onLabelClick={jest.fn()}
      />
    );
    expect(screen.getByText("No classifications")).toBeInTheDocument();
  });
});
