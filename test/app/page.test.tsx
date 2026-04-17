// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for home page (page.tsx).
 */

import { render, screen } from "@testing-library/react";
import React from "react";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}));

import Home from "@/app/page";

describe("Home page", () => {
  it("should render all four tool cards", () => {
    render(<Home />);
    expect(screen.getByText("Image Viewer")).toBeInTheDocument();
    expect(screen.getByText("Map Viewer")).toBeInTheDocument();
    expect(screen.getByText("Globe")).toBeInTheDocument();
    expect(screen.getByText("Geospatial Agent")).toBeInTheDocument();
  });

  it("should render card descriptions", () => {
    render(<Home />);
    expect(screen.getByText(/high-resolution imagery/)).toBeInTheDocument();
    expect(screen.getByText(/Interactive map interface/)).toBeInTheDocument();
  });

  it("should render links to each tool", () => {
    render(<Home />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/image");
    expect(hrefs).toContain("/map");
    expect(hrefs).toContain("/globe");
    expect(hrefs).toContain("/geo-agent");
  });

  it("should render emoji icons", () => {
    render(<Home />);
    expect(screen.getByText("🖼️")).toBeInTheDocument();
    expect(screen.getByText("🗺️")).toBeInTheDocument();
    expect(screen.getByText("🌎")).toBeInTheDocument();
    expect(screen.getByText("🕶️")).toBeInTheDocument();
  });
});
