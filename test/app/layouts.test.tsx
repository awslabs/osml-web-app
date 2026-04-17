// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for layout wrapper components.
 * Covers geo-agent/layout, globe/layout, image/layout, map/layout.
 */

import { render, screen } from "@testing-library/react";

import GeoAgentLayout from "@/app/geo-agent/layout";
import GlobeLayout from "@/app/globe/layout";
import ImageLayout from "@/app/image/layout";
import MapLayout from "@/app/map/layout";

describe("GeoAgentLayout", () => {
  it("should render children", () => {
    render(
      <GeoAgentLayout>
        <div data-testid="child">Content</div>
      </GeoAgentLayout>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});

describe("GlobeLayout", () => {
  it("should render children", () => {
    render(
      <GlobeLayout>
        <div data-testid="child">Content</div>
      </GlobeLayout>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});

describe("ImageLayout", () => {
  it("should render children", () => {
    render(
      <ImageLayout>
        <div data-testid="child">Content</div>
      </ImageLayout>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});

describe("MapLayout", () => {
  it("should render children", () => {
    render(
      <MapLayout>
        <div data-testid="child">Content</div>
      </MapLayout>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
