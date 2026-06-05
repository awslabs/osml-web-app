// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for Navbar component.
 * Covers rendering, login/logout state, and drawer toggle.
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { Navbar } from "@/components/navigation/navbar";

const mockUseSession = (
  jest.requireMock("next-auth/react") as { useSession: jest.Mock }
).useSession;

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { priority, unoptimized, ...rest } = props;
    void priority;
    void unoptimized;
    return <img {...rest} />;
  }
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a {...props}>{children}</a>
}));

import { renderWithStore } from "../../test-utils";

describe("Navbar", () => {
  it("should render the logo", () => {
    renderWithStore(<Navbar />);
    expect(screen.getByAltText("OversightML Logo")).toBeInTheDocument();
  });

  it("should show Logout when session exists", () => {
    mockUseSession.mockReturnValue({
      data: { accessToken: "tok" },
      status: "authenticated"
    });
    renderWithStore(<Navbar />);
    expect(screen.getByText("Logout")).toBeInTheDocument();
  });

  it("should show Login when no session", () => {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    renderWithStore(<Navbar />);
    expect(screen.getByText("Login")).toBeInTheDocument();
  });

  it("should show menu button on pages with sidebars", () => {
    const mockUsePathname = (
      jest.requireMock("next/navigation") as { usePathname: jest.Mock }
    ).usePathname;
    mockUsePathname.mockReturnValue("/globe");
    renderWithStore(<Navbar />);
    expect(screen.getByRole("button", { name: /menu/i })).toBeInTheDocument();
  });

  it("should dispatch toggleDrawer when menu button clicked", async () => {
    const mockUsePathname = (
      jest.requireMock("next/navigation") as { usePathname: jest.Mock }
    ).usePathname;
    mockUsePathname.mockReturnValue("/globe");
    const { store } = renderWithStore(<Navbar />);
    const menuBtn = screen.getByRole("button", { name: /menu/i });
    await userEvent.click(menuBtn);
    expect(store.getState().navbar.drawerOpen).toBe(true);
  });
});
