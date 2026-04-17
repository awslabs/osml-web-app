// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for image-utils.ts.
 * Covers calculateZoomOffset, buildTileUrl, buildMapTileUrlTemplate, parseStacUrl.
 */

import {
  buildMapTileUrlTemplate,
  buildTileUrl,
  calculateZoomOffset,
  parseStacUrl
} from "@/utils/image-utils";

describe("calculateZoomOffset", () => {
  it("should calculate offset for square image", () => {
    // 1024x1024 with 256 tile size → sqrt(1024/256) = 2 → ceil(2) = 2
    expect(calculateZoomOffset(1024, 1024, 256)).toBe(2);
  });

  it("should use the larger dimension", () => {
    // 2048x512 with 256 → sqrt(2048/256) = sqrt(8) ≈ 2.83 → ceil = 3
    expect(calculateZoomOffset(2048, 512, 256)).toBe(3);
  });

  it("should handle small images", () => {
    // 100x100 with 256 → sqrt(100/256) ≈ 0.625 → ceil = 1
    expect(calculateZoomOffset(100, 100, 256)).toBe(1);
  });

  it("should handle large images", () => {
    // 50000x50000 with 256 → sqrt(50000/256) ≈ 13.97 → ceil = 14
    expect(calculateZoomOffset(50000, 50000, 256)).toBe(14);
  });
});

describe("buildTileUrl", () => {
  it("should construct correct tile URL", () => {
    const url = buildTileUrl("https://api.example.com", "vp-1", 2, 3, 4, 5);
    expect(url).toBe(
      "https://api.example.com/latest/viewpoints/vp-1/image/tiles/3/3/4.PNG?compression=NONE"
    );
  });

  it("should subtract z from zoomOffset", () => {
    const url = buildTileUrl("https://api.example.com", "vp-1", 0, 0, 0, 3);
    expect(url).toContain("/tiles/3/0/0.PNG");
  });
});

describe("buildMapTileUrlTemplate", () => {
  it("should construct URL template with placeholders", () => {
    const template = buildMapTileUrlTemplate("https://api.example.com", "vp-1");
    expect(template).toBe(
      "https://api.example.com/latest/viewpoints/vp-1/map/tiles/WebMercatorQuad/{z}/{y}/{x}.PNG?invert_y=true"
    );
  });

  it("should include viewpoint ID in URL", () => {
    const template = buildMapTileUrlTemplate(
      "https://api.example.com",
      "my-viewpoint"
    );
    expect(template).toContain("my-viewpoint");
  });
});

describe("parseStacUrl", () => {
  it("should parse a standard STAC URL", () => {
    const result = parseStacUrl("/collections/landsat/items/scene-001");
    expect(result).toEqual({ collectionId: "landsat", itemId: "scene-001" });
  });

  it("should parse a full STAC URL with host", () => {
    const result = parseStacUrl(
      "https://stac.example.com/collections/sentinel/items/S2A_001"
    );
    expect(result).toEqual({ collectionId: "sentinel", itemId: "S2A_001" });
  });

  it("should return null for invalid URL without collections", () => {
    expect(parseStacUrl("/items/scene-001")).toBeNull();
  });

  it("should return null for invalid URL without items", () => {
    expect(parseStacUrl("/collections/landsat")).toBeNull();
  });

  it("should return null for empty string", () => {
    expect(parseStacUrl("")).toBeNull();
  });
});
