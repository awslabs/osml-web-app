// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for engine-agnostic map/globe rendering helpers.
 */

import { confidenceToColor } from "@/utils/color-utils";
import {
  getFeatureDisplayColor,
  isBelowConfidenceThreshold,
  makeClassificationColorResolver,
  MISSING_DATA_COLOR,
  parseStacItemUrl
} from "@/utils/map-rendering";

const PALETTE = ["#aa0000", "#00bb00", "#0000cc"];

describe("makeClassificationColorResolver", () => {
  it("assigns palette colors in order and is stable per label", () => {
    const resolve = makeClassificationColorResolver(PALETTE);
    expect(resolve("car")).toBe("#aa0000");
    expect(resolve("truck")).toBe("#00bb00");
    expect(resolve("car")).toBe("#aa0000"); // stable
    expect(resolve("boat")).toBe("#0000cc");
  });

  it("cycles through the palette when exhausted", () => {
    const resolve = makeClassificationColorResolver(PALETTE);
    resolve("a");
    resolve("b");
    resolve("c");
    expect(resolve("d")).toBe("#aa0000"); // wraps to index 0
  });

  it("uses an independent accumulator per resolver instance", () => {
    const a = makeClassificationColorResolver(PALETTE);
    const b = makeClassificationColorResolver(PALETTE);
    expect(a("truck")).toBe("#aa0000");
    expect(b("car")).toBe("#aa0000"); // b starts fresh
  });
});

describe("getFeatureDisplayColor", () => {
  const resolve = makeClassificationColorResolver(PALETTE);

  it("returns the base color in layer mode", () => {
    expect(getFeatureDisplayColor({}, "layer", "#123456", resolve)).toBe(
      "#123456"
    );
  });

  it("returns a gradient color in confidence mode when confidence exists", () => {
    expect(
      getFeatureDisplayColor(
        { confidence: 0.9 },
        "confidence",
        "#123456",
        resolve
      )
    ).toBe(confidenceToColor(0.9));
  });

  it("returns the missing-data color in confidence mode without confidence", () => {
    expect(getFeatureDisplayColor({}, "confidence", "#123456", resolve)).toBe(
      MISSING_DATA_COLOR
    );
  });

  it("returns a palette color in classification mode when class exists", () => {
    const r = makeClassificationColorResolver(PALETTE);
    expect(
      getFeatureDisplayColor(
        { classification: "vehicle" },
        "classification",
        "#123456",
        r
      )
    ).toBe("#aa0000");
  });

  it("returns the missing-data color in classification mode without class", () => {
    expect(
      getFeatureDisplayColor({}, "classification", "#123456", resolve)
    ).toBe(MISSING_DATA_COLOR);
  });
});

describe("isBelowConfidenceThreshold", () => {
  it("is false when threshold is 0 or less (filtering disabled)", () => {
    expect(isBelowConfidenceThreshold({ confidence: 0.1 }, 0)).toBe(false);
    expect(isBelowConfidenceThreshold({ confidence: 0.1 }, -1)).toBe(false);
  });

  it("is false when the feature has no confidence value", () => {
    expect(isBelowConfidenceThreshold({}, 0.5)).toBe(false);
  });

  it("is true only when confidence is strictly below the threshold", () => {
    expect(isBelowConfidenceThreshold({ confidence: 0.4 }, 0.5)).toBe(true);
    expect(isBelowConfidenceThreshold({ confidence: 0.5 }, 0.5)).toBe(false);
    expect(isBelowConfidenceThreshold({ confidence: 0.6 }, 0.5)).toBe(false);
  });
});

describe("parseStacItemUrl", () => {
  it("extracts collection and item ids from a well-formed URL", () => {
    expect(
      parseStacItemUrl("https://x/y/collections/airports/items/jfk-1")
    ).toEqual({ collectionId: "airports", itemId: "jfk-1" });
  });

  it("returns null when 'collections' or 'items' is absent", () => {
    expect(parseStacItemUrl("https://x/collections/airports")).toBeNull();
    expect(parseStacItemUrl("https://x/items/jfk-1")).toBeNull();
    expect(parseStacItemUrl("https://x/y/z")).toBeNull();
  });

  it("returns null when the id segment after the marker is missing", () => {
    expect(parseStacItemUrl("https://x/collections/airports/items")).toBeNull();
    expect(parseStacItemUrl("https://x/items/jfk-1/collections")).toBeNull();
  });
});
