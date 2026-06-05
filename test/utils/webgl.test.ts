// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for webgl.ts.
 * Covers adjustmentsToStyleVariables and isWebGLSupported.
 */

import { DEFAULT_ADJUSTMENTS } from "@/utils/image-adjustments";
import { adjustmentsToStyleVariables, isWebGLSupported } from "@/utils/webgl";

describe("adjustmentsToStyleVariables", () => {
  it("should convert default adjustments to style variables", () => {
    const result = adjustmentsToStyleVariables(DEFAULT_ADJUSTMENTS);
    expect(result.exposure).toBe(0);
    expect(result.contrast).toBe(0);
    expect(result.saturation).toBe(0);
    expect(result.gamma).toBe(1.0);
    expect(result.redGain).toBe(1.0);
    expect(result.greenGain).toBe(1.0);
    expect(result.blueGain).toBe(1.0);
  });

  it("should convert custom adjustments", () => {
    const result = adjustmentsToStyleVariables({
      exposure: 0.5,
      contrast: -0.3,
      saturation: 0.2,
      gamma: 1.5,
      redGain: 1.2,
      greenGain: 0.8,
      blueGain: 1.1
    });
    expect(result.exposure).toBe(0.5);
    expect(result.contrast).toBe(-0.3);
    expect(result.gamma).toBe(1.5);
  });

  it("should have exactly 7 keys", () => {
    const result = adjustmentsToStyleVariables(DEFAULT_ADJUSTMENTS);
    expect(Object.keys(result)).toHaveLength(7);
  });
});

describe("isWebGLSupported", () => {
  it("should return a boolean", () => {
    // jsdom doesn't have WebGL, so this will return false
    const result = isWebGLSupported();
    expect(typeof result).toBe("boolean");
  });
});

describe("isWebGLSupported - branch coverage", () => {
  it("should return false when WebGLRenderingContext is undefined", () => {
    const original = (window as unknown as Record<string, unknown>)
      .WebGLRenderingContext;
    delete (window as unknown as Record<string, unknown>).WebGLRenderingContext;

    expect(isWebGLSupported()).toBe(false);

    (window as unknown as Record<string, unknown>).WebGLRenderingContext =
      original;
  });

  it("should return false when getContext throws", () => {
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          getContext: () => {
            throw new Error("WebGL not supported");
          }
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tag);
    });

    expect(isWebGLSupported()).toBe(false);

    jest.restoreAllMocks();
  });

  it("should return true when webgl context is available", () => {
    const mockContext = {};
    const originalCreateElement = document.createElement.bind(document);
    (window as unknown as Record<string, unknown>).WebGLRenderingContext =
      function () {};

    jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          getContext: (type: string) => (type === "webgl" ? mockContext : null)
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tag);
    });

    expect(isWebGLSupported()).toBe(true);

    jest.restoreAllMocks();
  });

  it("should fall back to experimental-webgl", () => {
    const mockContext = {};
    const originalCreateElement = document.createElement.bind(document);
    (window as unknown as Record<string, unknown>).WebGLRenderingContext =
      function () {};

    jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          getContext: (type: string) =>
            type === "experimental-webgl" ? mockContext : null
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tag);
    });

    expect(isWebGLSupported()).toBe(true);

    jest.restoreAllMocks();
  });
});
