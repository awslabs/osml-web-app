// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for RouteTracker component.
 * Verifies it updates Redux route state based on pathname.
 */

import { RouteTracker } from "@/components/navigation/route-tracker";

import { renderWithStore } from "../../test-utils";

// next/navigation is mocked globally in jest.setup.js
const mockUsePathname = (
  jest.requireMock("next/navigation") as { usePathname: jest.Mock }
).usePathname;

describe("RouteTracker", () => {
  it("should render nothing (returns null)", () => {
    const { container } = renderWithStore(<RouteTracker />);
    expect(container.innerHTML).toBe("");
  });

  it("should update Redux route when pathname changes", () => {
    mockUsePathname.mockReturnValue("/globe");
    const { store } = renderWithStore(<RouteTracker />);
    expect(store.getState().navbar.currentRoute).toBe("/globe");
  });

  it("should update to different routes", () => {
    mockUsePathname.mockReturnValue("/map");
    const { store } = renderWithStore(<RouteTracker />);
    expect(store.getState().navbar.currentRoute).toBe("/map");
  });
});
