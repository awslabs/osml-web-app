// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for color-utils.ts.
 * Covers buildMarkerSvg, hexToRgb, hexToRgba, hexWithAlpha, confidenceToColor.
 */

import {
  buildMarkerSvg,
  confidenceToColor,
  hexToRgb,
  hexToRgba,
  hexWithAlpha
} from "@/utils/color-utils";

describe("buildMarkerSvg", () => {
  it("should return a data URI", () => {
    const result = buildMarkerSvg("#ff0000");
    expect(result).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("should embed the color in the SVG", () => {
    const result = buildMarkerSvg("#00ff00");
    const decoded = atob(result.split(",")[1]);
    expect(decoded).toContain("#00ff00");
  });

  it("should contain two circles (outer colored, inner white)", () => {
    const decoded = atob(buildMarkerSvg("#3388ff").split(",")[1]);
    expect((decoded.match(/<circle/g) || []).length).toBe(2);
    expect(decoded).toContain('fill="white"');
  });
});

describe("hexToRgb", () => {
  it("should parse #ff0000 to red", () => {
    expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("should parse #00ff00 to green", () => {
    expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
  });

  it("should parse #3388ff", () => {
    expect(hexToRgb("#3388ff")).toEqual({ r: 51, g: 136, b: 255 });
  });
});

describe("hexToRgba", () => {
  it("should convert hex + opacity to rgba string", () => {
    expect(hexToRgba("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("should handle full opacity", () => {
    expect(hexToRgba("#000000", 1)).toBe("rgba(0, 0, 0, 1)");
  });

  it("should handle zero opacity", () => {
    expect(hexToRgba("#ffffff", 0)).toBe("rgba(255, 255, 255, 0)");
  });
});

describe("hexWithAlpha", () => {
  it("should append alpha as hex suffix", () => {
    expect(hexWithAlpha("#ff0000", 1)).toBe("#ff0000ff");
  });

  it("should handle 50% opacity", () => {
    expect(hexWithAlpha("#ff0000", 0.5)).toBe("#ff000080");
  });

  it("should handle 0% opacity", () => {
    expect(hexWithAlpha("#ff0000", 0)).toBe("#ff000000");
  });

  it("should pad single-digit hex values", () => {
    // opacity 0.01 → Math.round(0.01 * 255) = 3 → "03"
    expect(hexWithAlpha("#000000", 0.01)).toBe("#00000003");
  });
});

describe("confidenceToColor", () => {
  it("should return red for 0 confidence", () => {
    expect(confidenceToColor(0)).toBe("#ff0000");
  });

  it("should return green for 1.0 confidence", () => {
    expect(confidenceToColor(1.0)).toBe("#00ff00");
  });

  it("should return yellow-ish for 0.5 confidence", () => {
    const color = confidenceToColor(0.5);
    // At 0.5: r=255, g=255 → #ffff00
    expect(color).toBe("#ffff00");
  });

  it("should return orange-ish for 0.25 confidence", () => {
    const color = confidenceToColor(0.25);
    // At 0.25: r=255, g=round(0.25*2*255)=128 → #ff8000
    expect(color).toBe("#ff8000");
  });

  it("should return lime-ish for 0.75 confidence", () => {
    const color = confidenceToColor(0.75);
    // At 0.75: r=round((1-(0.75-0.5)*2)*255)=128, g=255 → #80ff00
    expect(color).toBe("#80ff00");
  });
});
