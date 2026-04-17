// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for GlobeControls component.
 */

import { fireEvent, screen } from "@testing-library/react";

import { GlobeControls } from "@/components/sidebars/shared/globe-controls";

import { createTestStore, renderWithStore } from "../../../test-utils";

describe("GlobeControls", () => {
  it("should render all four switches", () => {
    renderWithStore(<GlobeControls />);
    expect(screen.getByText("Sun Lighting")).toBeInTheDocument();
    expect(screen.getByText("Ground Atmosphere")).toBeInTheDocument();
    expect(screen.getByText("Sky Atmosphere")).toBeInTheDocument();
    expect(screen.getByText("Fog")).toBeInTheDocument();
  });

  it("should toggle lighting when switch clicked", () => {
    const store = createTestStore();
    renderWithStore(<GlobeControls />, { store });

    const initialLighting = store.getState().settings.globe.enableLighting;
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0]); // Sun Lighting is first
    expect(store.getState().settings.globe.enableLighting).toBe(
      !initialLighting
    );
  });

  it("should toggle ground atmosphere", () => {
    const store = createTestStore();
    renderWithStore(<GlobeControls />, { store });

    const initial = store.getState().settings.globe.showGroundAtmosphere;
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]);
    expect(store.getState().settings.globe.showGroundAtmosphere).toBe(!initial);
  });

  it("should toggle sky atmosphere", () => {
    const store = createTestStore();
    renderWithStore(<GlobeControls />, { store });

    const initial = store.getState().settings.globe.showSkyAtmosphere;
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[2]);
    expect(store.getState().settings.globe.showSkyAtmosphere).toBe(!initial);
  });

  it("should toggle fog", () => {
    const store = createTestStore();
    renderWithStore(<GlobeControls />, { store });

    const initial = store.getState().settings.globe.enableFog;
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[3]);
    expect(store.getState().settings.globe.enableFog).toBe(!initial);
  });
});
