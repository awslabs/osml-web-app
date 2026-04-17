// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for globe-providers.ts.
 * Mocks Cesium to test provider generation without WebGL.
 */

// Mock cesium before importing the module
jest.mock("cesium", () => {
  const mockFromUrl = jest.fn().mockResolvedValue({ type: "imagery" });

  return {
    ArcGisMapServerImageryProvider: {
      fromUrl: mockFromUrl
    },
    CesiumTerrainProvider: {
      fromUrl: jest.fn().mockResolvedValue({ type: "terrain" })
    },
    EllipsoidTerrainProvider: jest.fn().mockImplementation(() => ({
      type: "ellipsoid-terrain"
    })),
    ProviderViewModel: jest
      .fn()
      .mockImplementation(
        (opts: {
          name: string;
          iconUrl: string;
          tooltip: string;
          creationFunction: () => unknown;
        }) => ({
          name: opts.name,
          iconUrl: opts.iconUrl,
          tooltip: opts.tooltip,
          creationFunction: opts.creationFunction
        })
      ),
    buildModuleUrl: jest.fn((path: string) => `https://cesium.com/${path}`)
  };
});

import {
  generateImageryProviders,
  generateProviderViewModels,
  generateTerrainProviders,
  generateTerrainProviderViewModels
} from "@/utils/globe-providers";

describe("globe-providers", () => {
  describe("generateProviderViewModels", () => {
    it("should return an array of provider view models", () => {
      const models = generateProviderViewModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty("name");
      expect(models[0]).toHaveProperty("iconUrl");
      expect(models[0]).toHaveProperty("tooltip");
    });

    it("should include World Imagery provider", () => {
      const models = generateProviderViewModels();
      expect(models.find((m) => m.name === "World Imagery")).toBeDefined();
    });

    it("should include World Street Map provider", () => {
      const models = generateProviderViewModels();
      expect(models.find((m) => m.name === "World Street Map")).toBeDefined();
    });
  });

  describe("generateImageryProviders", () => {
    it("should return an array of imagery providers", async () => {
      const providers = await generateImageryProviders();
      expect(providers.length).toBeGreaterThan(0);
    });
  });

  describe("generateTerrainProviderViewModels", () => {
    it("should return terrain provider view models", () => {
      const models = generateTerrainProviderViewModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty("name");
      expect(models[0].name).toBe("WGS84 Ellipsoid");
    });
  });

  describe("generateTerrainProviders", () => {
    it("should return terrain providers including ellipsoid", async () => {
      const providers = await generateTerrainProviders();
      expect(providers.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for creationFunction callbacks (lines 68, 104-120)
// ---------------------------------------------------------------------------

describe("globe-providers - creationFunction coverage", () => {
  it("imagery provider view model creationFunction should call ArcGisMapServerImageryProvider.fromUrl", () => {
    const models = generateProviderViewModels();
    const worldImagery = models.find((m) => m.name === "World Imagery");
    expect(worldImagery).toBeDefined();

    // Call the creationFunction to cover the inner function
    const result: unknown = worldImagery!.creationFunction();
    expect(result).toBeDefined();
  });

  it("terrain provider view model creationFunction should create EllipsoidTerrainProvider", () => {
    const models = generateTerrainProviderViewModels();
    const ellipsoid = models.find((m) => m.name === "WGS84 Ellipsoid");
    expect(ellipsoid).toBeDefined();

    // Call the creationFunction to cover the inner function
    const result: unknown = ellipsoid!.creationFunction();
    expect(result).toBeDefined();
  });

  it("should generate all 4 imagery provider view models", () => {
    const models = generateProviderViewModels();
    expect(models).toHaveLength(4);
    expect(models.map((m) => m.name)).toEqual([
      "World Imagery",
      "World Street Map",
      "World Light Grey Base",
      "World Dark Gray Base"
    ]);
  });
});
