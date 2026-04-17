// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for config/fonts.ts — font configuration exports.
 */

jest.mock("next/font/google", () => ({
  Inter: jest.fn(() => ({ variable: "--font-sans", className: "font-sans" })),
  Fira_Code: jest.fn(() => ({
    variable: "--font-mono",
    className: "font-mono"
  }))
}));

import { fontMono, fontSans } from "@/config/fonts";

describe("fonts", () => {
  it("should export fontSans with correct variable", () => {
    expect(fontSans).toBeDefined();
    expect(fontSans.variable).toBe("--font-sans");
  });

  it("should export fontMono with correct variable", () => {
    expect(fontMono).toBeDefined();
    expect(fontMono.variable).toBe("--font-mono");
  });
});
