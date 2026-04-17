// Copyright Amazon.com, Inc. or its affiliates.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { ConfidenceHistogram } from "@/components/analytics/confidence-histogram";

describe("ConfidenceHistogram", () => {
  const defaultBins = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

  it("renders 10 bars as SVG rect elements", () => {
    const { container } = render(
      <ConfidenceHistogram
        bins={defaultBins}
        activeBins={new Set()}
        onBinClick={jest.fn()}
      />
    );
    const rects = container.querySelectorAll("rect[data-bin]");
    expect(rects).toHaveLength(10);
  });

  it("colors bars with a red-to-green gradient", () => {
    const { container } = render(
      <ConfidenceHistogram
        bins={defaultBins}
        activeBins={new Set()}
        onBinClick={jest.fn()}
      />
    );
    const rects = container.querySelectorAll("rect[data-bin]");
    // First bar should be reddish, last bar should be greenish
    const firstFill = rects[0].getAttribute("fill") ?? "";
    const lastFill = rects[9].getAttribute("fill") ?? "";
    // Red channel should be high for first bar
    expect(firstFill).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(lastFill).toMatch(/^#[0-9a-fA-F]{6}$/);
    // First bar should have more red, last bar should have more green
    const parseHex = (hex: string) => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16)
    });
    const first = parseHex(firstFill);
    const last = parseHex(lastFill);
    expect(first.r).toBeGreaterThan(first.g);
    expect(last.g).toBeGreaterThan(last.r);
  });

  it("fires onBinClick with the correct bin index when a bar is clicked", () => {
    const onBinClick = jest.fn();
    const { container } = render(
      <ConfidenceHistogram
        bins={defaultBins}
        activeBins={new Set()}
        onBinClick={onBinClick}
      />
    );
    const rects = container.querySelectorAll("rect[data-bin]");
    fireEvent.click(rects[3]);
    expect(onBinClick).toHaveBeenCalledWith(3);
    fireEvent.click(rects[7]);
    expect(onBinClick).toHaveBeenCalledWith(7);
  });

  it("renders a white border (stroke) on active bins", () => {
    const activeBins = new Set([2, 5]);
    const { container } = render(
      <ConfidenceHistogram
        bins={defaultBins}
        activeBins={activeBins}
        onBinClick={jest.fn()}
      />
    );
    const rects = container.querySelectorAll("rect[data-bin]");
    expect(rects[2].getAttribute("stroke")).toBe("white");
    expect(rects[5].getAttribute("stroke")).toBe("white");
    // Non-active bins should not have white stroke
    expect(rects[0].getAttribute("stroke")).not.toBe("white");
    expect(rects[9].getAttribute("stroke")).not.toBe("white");
  });

  it('displays "No data" placeholder when all bins are zero', () => {
    const zeroBins = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    render(
      <ConfidenceHistogram
        bins={zeroBins}
        activeBins={new Set()}
        onBinClick={jest.fn()}
      />
    );
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});
