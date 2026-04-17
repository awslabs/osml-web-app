// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for RootLayout (src/app/layout.tsx).
 * Covers the server component that wraps children in RootLayoutClient.
 */

// Mock next-auth
jest.mock("next-auth", () => ({
  getServerSession: jest.fn()
}));

jest.mock("@/auth/config", () => ({
  authOptions: {}
}));

jest.mock("@/app/layout-client", () => ({
  RootLayoutClient: ({
    children,
    session
  }: {
    children: React.ReactNode;
    session: unknown;
  }) => (
    <div
      data-testid="root-layout-client"
      data-session={session ? "authenticated" : "none"}
    >
      {children}
    </div>
  )
}));

// Mock the CSS import that Jest can't parse
jest.mock("@/styles/globals.css", () => ({}));

import { render, screen } from "@testing-library/react";
import { getServerSession } from "next-auth";
import React from "react";

import RootLayout, { metadata, viewport } from "@/app/layout";

describe("RootLayout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_CLIENT_ID;
  });

  it("should render children inside RootLayoutClient", async () => {
    const Layout = await RootLayout({ children: <div>Test Content</div> });
    render(Layout as React.ReactElement);
    expect(screen.getByText("Test Content")).toBeInTheDocument();
    expect(screen.getByTestId("root-layout-client")).toBeInTheDocument();
  });

  it("should pass null session when auth env vars not set", async () => {
    const Layout = await RootLayout({ children: <div>Child</div> });
    render(Layout as React.ReactElement);
    expect(screen.getByTestId("root-layout-client")).toHaveAttribute(
      "data-session",
      "none"
    );
    expect(getServerSession).not.toHaveBeenCalled();
  });

  it("should attempt to get session when auth env vars are set", async () => {
    process.env.NEXTAUTH_SECRET = "test-secret";
    process.env.NEXTAUTH_CLIENT_ID = "test-client-id";
    (getServerSession as jest.Mock).mockResolvedValue({
      user: { name: "Test" }
    });

    const Layout = await RootLayout({ children: <div>Child</div> });
    render(Layout as React.ReactElement);
    expect(getServerSession).toHaveBeenCalled();
    expect(screen.getByTestId("root-layout-client")).toHaveAttribute(
      "data-session",
      "authenticated"
    );
  });

  it("should handle getServerSession returning null", async () => {
    process.env.NEXTAUTH_SECRET = "test-secret";
    process.env.NEXTAUTH_CLIENT_ID = "test-client-id";
    (getServerSession as jest.Mock).mockResolvedValue(null);

    const Layout = await RootLayout({ children: <div>Child</div> });
    render(Layout as React.ReactElement);
    expect(screen.getByTestId("root-layout-client")).toHaveAttribute(
      "data-session",
      "none"
    );
  });
});

describe("metadata", () => {
  it("should have title and description", () => {
    expect(metadata.title).toBeDefined();
    expect(metadata.description).toBeDefined();
  });

  it("should have favicon icon", () => {
    expect(metadata.icons).toBeDefined();
  });
});

describe("viewport", () => {
  it("should have theme color definitions", () => {
    expect(viewport.themeColor).toHaveLength(2);
  });
});
