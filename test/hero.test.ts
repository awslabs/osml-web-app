// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for hero.ts — HeroUI theme plugin export.
 */

jest.mock("@heroui/theme", () => ({
  heroui: jest.fn(() => ({ name: "heroui-plugin" }))
}));

import heroPlugin from "@/hero";

describe("hero", () => {
  it("should export the heroui plugin result", () => {
    expect(heroPlugin).toBeDefined();
    expect(heroPlugin).toEqual({ name: "heroui-plugin" });
  });
});
