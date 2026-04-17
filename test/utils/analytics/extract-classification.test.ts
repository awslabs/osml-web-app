// Copyright Amazon.com, Inc. or its affiliates.
import * as fc from "fast-check";

import { extractClassification } from "@/utils/analytics/extract-classification";

// ---------------------------------------------------------------------------
// Helpers & Generators
// ---------------------------------------------------------------------------

/** Arbitrary that picks a random classification key in various casings. */
const classificationKeyArb = fc.oneof(
  fc.constant("classification"),
  fc.constant("Classification"),
  fc.constant("CLASSIFICATION"),
  fc.constant("class"),
  fc.constant("Class"),
  fc.constant("CLASS"),
  fc.constant("category"),
  fc.constant("Category"),
  fc.constant("CATEGORY"),
  fc.constant("label"),
  fc.constant("Label"),
  fc.constant("LABEL"),
  fc.constant("featureclassiri"),
  fc.constant("featureClassIri"),
  fc.constant("FEATURECLASSIRI")
);

/** Arbitrary non-empty string for classification values. */
const classificationValueArb = fc.string({ minLength: 1, maxLength: 50 });

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("extractClassification", () => {
  describe("unit tests", () => {
    it("returns undefined for empty properties", () => {
      expect(extractClassification({})).toBeUndefined();
    });

    it("returns iri from feature_classes array", () => {
      const props = {
        feature_classes: [{ iri: "http://example.com/Building", score: 0.9 }]
      };
      expect(extractClassification(props)).toBe("http://example.com/Building");
    });

    it("returns iri from featureClasses array (camelCase variant)", () => {
      const props = {
        featureClasses: [{ iri: "http://example.com/Vehicle", score: 0.8 }]
      };
      expect(extractClassification(props)).toBe("http://example.com/Vehicle");
    });

    it("returns first iri when feature_classes has multiple items", () => {
      const props = {
        feature_classes: [
          { iri: "http://example.com/First", score: 0.5 },
          { iri: "http://example.com/Second", score: 0.9 }
        ]
      };
      expect(extractClassification(props)).toBe("http://example.com/First");
    });

    it("falls back to top-level keys when feature_classes is empty", () => {
      const props = {
        feature_classes: [],
        classification: "Tank"
      };
      expect(extractClassification(props)).toBe("Tank");
    });

    it("falls back to top-level keys when feature_classes items lack iri", () => {
      const props = {
        feature_classes: [{ name: "NoIri", score: 0.9 }],
        classification: "Fallback"
      };
      expect(extractClassification(props)).toBe("Fallback");
    });

    it("returns top-level classification key value", () => {
      expect(extractClassification({ classification: "Building" })).toBe(
        "Building"
      );
    });

    it("returns top-level class key value", () => {
      expect(extractClassification({ class: "Vehicle" })).toBe("Vehicle");
    });

    it("returns top-level category key value", () => {
      expect(extractClassification({ category: "Aircraft" })).toBe("Aircraft");
    });

    it("returns top-level label key value", () => {
      expect(extractClassification({ label: "Ship" })).toBe("Ship");
    });

    it("returns top-level featureclassiri key value (case-insensitive)", () => {
      expect(
        extractClassification({ featureClassIri: "http://example.com/Tank" })
      ).toBe("http://example.com/Tank");
    });

    it("handles case-insensitive key matching for top-level keys", () => {
      expect(extractClassification({ CLASSIFICATION: "Upper" })).toBe("Upper");
      expect(extractClassification({ Category: "Mixed" })).toBe("Mixed");
      expect(extractClassification({ LABEL: "AllCaps" })).toBe("AllCaps");
    });

    it("skips non-string values at top level", () => {
      expect(extractClassification({ classification: 42 })).toBeUndefined();
      expect(extractClassification({ classification: true })).toBeUndefined();
      expect(extractClassification({ classification: null })).toBeUndefined();
      expect(
        extractClassification({ classification: undefined })
      ).toBeUndefined();
      expect(
        extractClassification({ classification: ["array"] })
      ).toBeUndefined();
    });

    it("searches one level into nested objects", () => {
      const props = {
        details: {
          classification: "NestedBuilding"
        }
      };
      expect(extractClassification(props)).toBe("NestedBuilding");
    });

    it("skips non-string values in nested objects", () => {
      const props = {
        details: {
          classification: 123
        }
      };
      expect(extractClassification(props)).toBeUndefined();
    });

    it("returns undefined when no classification found at any level", () => {
      const props = {
        name: "feature-1",
        area: 500,
        details: {
          color: "red",
          size: 42
        }
      };
      expect(extractClassification(props)).toBeUndefined();
    });

    it("feature_classes takes priority over top-level keys", () => {
      const props = {
        feature_classes: [{ iri: "http://example.com/Priority" }],
        classification: "ShouldNotReturn"
      };
      expect(extractClassification(props)).toBe("http://example.com/Priority");
    });

    it("top-level keys take priority over nested object search", () => {
      const props = {
        classification: "TopLevel",
        details: {
          classification: "Nested"
        }
      };
      expect(extractClassification(props)).toBe("TopLevel");
    });

    it("handles properties with only non-classification keys", () => {
      expect(
        extractClassification({ name: "building", area: 42, color: "red" })
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Property-Based Tests
  // -------------------------------------------------------------------------

  describe("classification extraction priority chain", () => {
    it("feature_classes with iri always wins over other levels", () => {
      fc.assert(
        fc.property(
          classificationValueArb,
          classificationKeyArb,
          classificationValueArb,
          classificationValueArb,
          (iri, topKey, topValue, nestedValue) => {
            const props: Record<string, unknown> = {
              feature_classes: [{ iri }],
              [topKey]: topValue,
              nested: { classification: nestedValue }
            };
            const result = extractClassification(props);
            expect(result).toBe(iri);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("top-level classification key wins when no feature_classes present", () => {
      fc.assert(
        fc.property(
          classificationKeyArb,
          classificationValueArb,
          classificationValueArb,
          (topKey, topValue, nestedValue) => {
            const props: Record<string, unknown> = {
              [topKey]: topValue,
              nested: { classification: nestedValue }
            };
            const result = extractClassification(props);
            expect(result).toBe(topValue);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("nested classification key is used when no feature_classes or top-level key", () => {
      fc.assert(
        fc.property(classificationValueArb, (nestedValue) => {
          const props: Record<string, unknown> = {
            someOtherProp: 42,
            nested: { classification: nestedValue }
          };
          const result = extractClassification(props);
          expect(result).toBe(nestedValue);
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it("returns undefined when no classification data exists at any level", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 0, max: 1000 }),
          (strVal, numVal) => {
            // Use keys that are NOT classification-like
            const props: Record<string, unknown> = {
              name: strVal,
              count: numVal,
              metadata: { color: strVal, size: numVal }
            };
            const result = extractClassification(props);
            expect(result).toBeUndefined();
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("empty feature_classes array falls through to top-level keys", () => {
      fc.assert(
        fc.property(
          classificationKeyArb,
          classificationValueArb,
          (topKey, topValue) => {
            const props: Record<string, unknown> = {
              feature_classes: [],
              [topKey]: topValue
            };
            const result = extractClassification(props);
            expect(result).toBe(topValue);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it("feature_classes items without iri fall through to top-level keys", () => {
      fc.assert(
        fc.property(
          classificationKeyArb,
          classificationValueArb,
          (topKey, topValue) => {
            const props: Record<string, unknown> = {
              feature_classes: [{ name: "no-iri", score: 0.5 }],
              [topKey]: topValue
            };
            const result = extractClassification(props);
            expect(result).toBe(topValue);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
