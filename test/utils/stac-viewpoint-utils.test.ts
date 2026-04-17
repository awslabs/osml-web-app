// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for STAC item to viewpoint integration utilities.
 * Covers S3 URL parsing, image asset selection, viewpoint ID/name generation,
 * asset compatibility checks, and viewpoint request building.
 */

import type { StacAsset, StacItem } from "stac-ts";

import {
  extractS3Location,
  findImageAsset,
  generateViewpointId,
  generateViewpointName,
  getViewpointRequestFromStacItem,
  hasViewableImageAsset,
  isViewpointCompatibleAsset
} from "@/utils/stac-viewpoint-utils";

// ---------------------------------------------------------------------------
// extractS3Location
// ---------------------------------------------------------------------------
describe("extractS3Location", () => {
  describe("s3:// protocol URLs", () => {
    it("should parse a standard s3:// URL", () => {
      const result = extractS3Location("s3://my-bucket/path/to/file.tif");
      expect(result).toEqual({ bucket: "my-bucket", key: "path/to/file.tif" });
    });

    it("should parse s3:// URL with a single-segment key", () => {
      const result = extractS3Location("s3://bucket/file.tif");
      expect(result).toEqual({ bucket: "bucket", key: "file.tif" });
    });

    it("should parse s3:// URL with deeply nested key", () => {
      const result = extractS3Location("s3://data-bucket/a/b/c/d/image.nitf");
      expect(result).toEqual({
        bucket: "data-bucket",
        key: "a/b/c/d/image.nitf"
      });
    });
  });

  describe("virtual-hosted style URLs", () => {
    it("should parse https://bucket.s3.region.amazonaws.com/key", () => {
      const result = extractS3Location(
        "https://my-bucket.s3.us-east-1.amazonaws.com/images/scene.tif"
      );
      expect(result).toEqual({
        bucket: "my-bucket",
        key: "images/scene.tif"
      });
    });

    it("should parse https://bucket.s3-region.amazonaws.com/key", () => {
      const result = extractS3Location(
        "https://my-bucket.s3-us-west-2.amazonaws.com/data.tif"
      );
      expect(result).toEqual({ bucket: "my-bucket", key: "data.tif" });
    });

    it("should parse http:// virtual-hosted URLs", () => {
      const result = extractS3Location(
        "http://bucket.s3.eu-west-1.amazonaws.com/key.tif"
      );
      expect(result).toEqual({ bucket: "bucket", key: "key.tif" });
    });
  });

  describe("path-style URLs", () => {
    it("should parse https://s3.region.amazonaws.com/bucket/key", () => {
      const result = extractS3Location(
        "https://s3.us-east-1.amazonaws.com/my-bucket/path/file.tif"
      );
      expect(result).toEqual({
        bucket: "my-bucket",
        key: "path/file.tif"
      });
    });

    it("should parse https://s3-region.amazonaws.com/bucket/key", () => {
      const result = extractS3Location(
        "https://s3-us-west-2.amazonaws.com/my-bucket/file.tif"
      );
      expect(result).toEqual({ bucket: "my-bucket", key: "file.tif" });
    });
  });

  describe("edge cases and invalid inputs", () => {
    it("should return null for empty string", () => {
      expect(extractS3Location("")).toBeNull();
    });

    it("should return null for a non-S3 HTTPS URL", () => {
      expect(
        extractS3Location("https://example.com/bucket/key.tif")
      ).toBeNull();
    });

    it("should return null for a plain file path", () => {
      expect(extractS3Location("/local/path/to/file.tif")).toBeNull();
    });

    it("should return null for an ftp URL", () => {
      expect(extractS3Location("ftp://bucket/key")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// findImageAsset
// ---------------------------------------------------------------------------
describe("findImageAsset", () => {
  const makeItem = (assets: Record<string, Partial<StacAsset>>): StacItem =>
    ({
      type: "Feature",
      stac_version: "1.0.0",
      id: "test-item",
      geometry: null,
      bbox: null,
      properties: { datetime: null },
      links: [],
      assets: assets as Record<string, StacAsset>
    }) as unknown as StacItem;

  it("should prioritise COG with data role (priority 1)", () => {
    const item = makeItem({
      thumbnail: {
        href: "s3://b/thumb.png",
        type: "image/png",
        roles: ["thumbnail"]
      },
      data: {
        href: "s3://b/cog.tif",
        type: "image/tiff; application=geotiff; profile=cloud-optimized",
        roles: ["data"]
      }
    });

    const result = findImageAsset(item);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("data");
  });

  it("should fall back to GeoTIFF with data role (priority 2)", () => {
    const item = makeItem({
      data: {
        href: "s3://b/scene.tif",
        type: "image/tiff; application=geotiff",
        roles: ["data"]
      }
    });

    const result = findImageAsset(item);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("data");
  });

  it("should fall back to any image with data role (priority 3)", () => {
    const item = makeItem({
      data: {
        href: "s3://b/scene.png",
        type: "image/png",
        roles: ["data"]
      }
    });

    const result = findImageAsset(item);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("data");
  });

  it("should fall back to any image asset (priority 4)", () => {
    const item = makeItem({
      visual: {
        href: "s3://b/visual.tif",
        type: "image/tiff",
        roles: ["visual"]
      }
    });

    const result = findImageAsset(item);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("visual");
  });

  it("should return null when no image assets exist", () => {
    const item = makeItem({
      metadata: {
        href: "s3://b/meta.json",
        type: "application/json",
        roles: ["metadata"]
      }
    });

    expect(findImageAsset(item)).toBeNull();
  });

  it("should return null for null/undefined item", () => {
    expect(findImageAsset(null as unknown as StacItem)).toBeNull();
  });

  it("should return null for item with no assets", () => {
    const item = {
      type: "Feature",
      stac_version: "1.0.0",
      id: "test",
      geometry: null,
      bbox: null,
      properties: { datetime: null },
      links: []
    } as unknown as StacItem;

    expect(findImageAsset(item)).toBeNull();
  });

  it("should prefer COG data over plain GeoTIFF data", () => {
    const item = makeItem({
      plain: {
        href: "s3://b/plain.tif",
        type: "image/tiff; application=geotiff",
        roles: ["data"]
      },
      cog: {
        href: "s3://b/cog.tif",
        type: "image/tiff; application=geotiff; profile=cloud-optimized",
        roles: ["data"]
      }
    });

    const result = findImageAsset(item);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("cog");
  });
});

// ---------------------------------------------------------------------------
// hasViewableImageAsset
// ---------------------------------------------------------------------------
describe("hasViewableImageAsset", () => {
  const makeItem = (assets: Record<string, Partial<StacAsset>>): StacItem =>
    ({
      type: "Feature",
      stac_version: "1.0.0",
      id: "test-item",
      geometry: null,
      bbox: null,
      properties: { datetime: null },
      links: [],
      assets: assets as Record<string, StacAsset>
    }) as unknown as StacItem;

  it("should return true when item has image asset with S3 location", () => {
    const item = makeItem({
      data: {
        href: "s3://bucket/image.tif",
        type: "image/tiff",
        roles: ["data"]
      }
    });
    expect(hasViewableImageAsset(item)).toBe(true);
  });

  it("should return false when image asset has non-S3 URL", () => {
    const item = makeItem({
      data: {
        href: "https://example.com/image.tif",
        type: "image/tiff",
        roles: ["data"]
      }
    });
    expect(hasViewableImageAsset(item)).toBe(false);
  });

  it("should return false when no image assets exist", () => {
    const item = makeItem({
      meta: {
        href: "s3://bucket/meta.json",
        type: "application/json",
        roles: ["metadata"]
      }
    });
    expect(hasViewableImageAsset(item)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateViewpointId / generateViewpointName
// ---------------------------------------------------------------------------
describe("generateViewpointId", () => {
  it("should join collection and item ID with double dash", () => {
    expect(generateViewpointId("landsat-c2-l2", "LC08_042034")).toBe(
      "landsat-c2-l2--LC08_042034"
    );
  });

  it("should handle empty collection ID", () => {
    expect(generateViewpointId("", "item-1")).toBe("--item-1");
  });
});

describe("generateViewpointName", () => {
  it("should use item title when available", () => {
    const item = {
      id: "item-123",
      properties: { title: "Landsat Scene", datetime: null }
    } as unknown as StacItem;
    expect(generateViewpointName(item)).toBe("Landsat Scene");
  });

  it("should fall back to item ID when title is missing", () => {
    const item = {
      id: "item-123",
      properties: { datetime: null }
    } as unknown as StacItem;
    expect(generateViewpointName(item)).toBe("item-123");
  });
});

// ---------------------------------------------------------------------------
// isViewpointCompatibleAsset
// ---------------------------------------------------------------------------
describe("isViewpointCompatibleAsset", () => {
  it("should accept image/tiff with S3 href", () => {
    const asset: StacAsset = {
      href: "s3://bucket/file.tif",
      type: "image/tiff"
    } as StacAsset;
    expect(isViewpointCompatibleAsset(asset)).toBe(true);
  });

  it("should accept image/geotiff with S3 href", () => {
    const asset: StacAsset = {
      href: "s3://bucket/file.tif",
      type: "image/geotiff"
    } as StacAsset;
    expect(isViewpointCompatibleAsset(asset)).toBe(true);
  });

  it("should accept image/nitf with S3 href", () => {
    const asset: StacAsset = {
      href: "s3://bucket/file.nitf",
      type: "image/nitf"
    } as StacAsset;
    expect(isViewpointCompatibleAsset(asset)).toBe(true);
  });

  it("should reject unsupported image types", () => {
    const asset: StacAsset = {
      href: "s3://bucket/file.png",
      type: "image/png"
    } as StacAsset;
    expect(isViewpointCompatibleAsset(asset)).toBe(false);
  });

  it("should reject non-image types even with S3 href", () => {
    const asset: StacAsset = {
      href: "s3://bucket/file.json",
      type: "application/json"
    } as StacAsset;
    expect(isViewpointCompatibleAsset(asset)).toBe(false);
  });

  it("should reject supported type with non-S3 href", () => {
    const asset: StacAsset = {
      href: "https://example.com/file.tif",
      type: "image/tiff"
    } as StacAsset;
    expect(isViewpointCompatibleAsset(asset)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getViewpointRequestFromStacItem
// ---------------------------------------------------------------------------
describe("getViewpointRequestFromStacItem", () => {
  const makeItem = (
    assets: Record<string, Partial<StacAsset>>,
    overrides: Partial<StacItem> = {}
  ): StacItem =>
    ({
      type: "Feature",
      stac_version: "1.0.0",
      id: "scene-001",
      collection: "my-collection",
      geometry: null,
      bbox: null,
      properties: { datetime: null, title: "My Scene" },
      links: [],
      assets: assets as Record<string, StacAsset>,
      ...overrides
    }) as unknown as StacItem;

  it("should build a complete viewpoint request from a valid STAC item", () => {
    const item = makeItem({
      data: {
        href: "s3://imagery-bucket/scenes/scene-001.tif",
        type: "image/tiff; application=geotiff; profile=cloud-optimized",
        roles: ["data"]
      }
    });

    const result = getViewpointRequestFromStacItem(item);
    expect(result).toEqual({
      viewpoint_id: "my-collection--scene-001",
      viewpoint_name: "My Scene",
      bucket_name: "imagery-bucket",
      object_key: "scenes/scene-001.tif",
      tile_size: 256,
      range_adjustment: "DRA"
    });
  });

  it("should return null when item has no image assets", () => {
    const item = makeItem({
      meta: {
        href: "s3://b/meta.json",
        type: "application/json",
        roles: ["metadata"]
      }
    });
    expect(getViewpointRequestFromStacItem(item)).toBeNull();
  });

  it("should return null when image asset has non-S3 URL", () => {
    const item = makeItem({
      data: {
        href: "https://example.com/scene.tif",
        type: "image/tiff",
        roles: ["data"]
      }
    });
    expect(getViewpointRequestFromStacItem(item)).toBeNull();
  });

  it("should handle missing collection gracefully", () => {
    const item = makeItem(
      {
        data: {
          href: "s3://bucket/file.tif",
          type: "image/tiff; application=geotiff; profile=cloud-optimized",
          roles: ["data"]
        }
      },
      { collection: undefined }
    );

    const result = getViewpointRequestFromStacItem(item);
    expect(result).not.toBeNull();
    expect(result!.viewpoint_id).toBe("--scene-001");
  });

  it("should use item ID as name when title is missing", () => {
    const item = makeItem(
      {
        data: {
          href: "s3://bucket/file.tif",
          type: "image/tiff; application=geotiff; profile=cloud-optimized",
          roles: ["data"]
        }
      },
      { properties: { datetime: null } }
    );

    const result = getViewpointRequestFromStacItem(item);
    expect(result).not.toBeNull();
    expect(result!.viewpoint_name).toBe("scene-001");
  });
});
