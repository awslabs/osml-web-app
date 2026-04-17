// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for MapControls component.
 */

import { fireEvent, screen } from "@testing-library/react";

import { MapControls } from "@/components/sidebars/shared/map-controls";

import { createTestStore, renderWithStore } from "../../../test-utils";

describe("MapControls", () => {
  it("should render day/night switch", () => {
    renderWithStore(<MapControls />);
    expect(screen.getByText("Day/Night Terminator")).toBeInTheDocument();
  });

  it("should toggle day/night when switch clicked", () => {
    const store = createTestStore();
    renderWithStore(<MapControls />, { store });

    const initial = store.getState().settings.map.dayNightEnabled;
    fireEvent.click(screen.getByRole("switch"));
    expect(store.getState().settings.map.dayNightEnabled).toBe(!initial);
  });
});
