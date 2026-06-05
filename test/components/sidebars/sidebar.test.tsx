// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for Sidebar component.
 * Covers rendering children and open/close state from Redux.
 */

import { screen } from "@testing-library/react";

import { Sidebar } from "@/components/sidebars/sidebar";
import { setDrawerOpen } from "@/store/slices/navbar-slice";

import { createTestStore, renderWithStore } from "../../test-utils";

describe("Sidebar", () => {
  it("should render children when open", () => {
    const store = createTestStore();
    store.dispatch(setDrawerOpen(true));
    renderWithStore(
      <Sidebar>
        <div data-testid="sidebar-content">Content</div>
      </Sidebar>,
      { store }
    );
    expect(screen.getByTestId("sidebar-content")).toBeInTheDocument();
  });

  it("should render without children", () => {
    const store = createTestStore();
    store.dispatch(setDrawerOpen(true));
    renderWithStore(<Sidebar />, { store });
  });
});
