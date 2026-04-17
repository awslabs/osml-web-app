// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for globe-popup-formatter.ts.
 * Covers formatEntityProperties with detection features, STAC items,
 * agent features, and various value formatting edge cases.
 */

import { formatEntityProperties } from "@/utils/globe-popup-formatter";

describe("formatEntityProperties", () => {
  describe("title extraction", () => {
    it("should use description as title when available", () => {
      const { title } = formatEntityProperties({ description: "My Feature" });
      expect(title).toBe("My Feature");
    });

    it("should fall back to name", () => {
      const { title } = formatEntityProperties({ name: "Named Feature" });
      expect(title).toBe("Named Feature");
    });

    it("should fall back to title property", () => {
      const { title } = formatEntityProperties({ title: "Titled Feature" });
      expect(title).toBe("Titled Feature");
    });

    it("should default to 'Feature' when no title fields exist", () => {
      const { title } = formatEntityProperties({ someField: 123 });
      expect(title).toBe("Feature");
    });
  });

  describe("ML detection features", () => {
    it("should format featureClasses into Classification group", () => {
      const { groups } = formatEntityProperties({
        featureClasses: [
          { iri: "building", score: 0.95 },
          { iri: "vehicle", score: 0.72 }
        ]
      });

      const classification = groups.find((g) => g.label === "Classification");
      expect(classification).toBeDefined();
      expect(classification!.entries).toHaveLength(4); // 2 classes × (Class + Score)
      expect(classification!.entries[0].value).toBe("building");
      expect(classification!.entries[1].value).toBe("95.0%");
    });

    it("should extract job ID from entity name pattern", () => {
      const { groups } = formatEntityProperties(
        { someField: "value" },
        "job-abc-123::entity-456"
      );

      const metadata = groups.find((g) => g.label === "Metadata");
      expect(metadata).toBeDefined();
      const jobEntry = metadata!.entries.find((e) => e.key === "Job ID");
      expect(jobEntry?.value).toBe("job-abc-123");
    });

    it("should format inferenceMetadata", () => {
      const { groups } = formatEntityProperties({
        inferenceMetadata: {
          jobId: "job-123",
          inferenceDT: "2024-06-15T12:00:00Z"
        }
      });

      const metadata = groups.find((g) => g.label === "Metadata");
      expect(metadata).toBeDefined();
      expect(metadata!.entries.find((e) => e.key === "Job ID")?.value).toBe(
        "job-123"
      );
    });
  });

  describe("location entries", () => {
    it("should format center_latitude and center_longitude", () => {
      const { groups } = formatEntityProperties({
        center_latitude: 37.7749,
        center_longitude: -122.4194
      });

      const location = groups.find((g) => g.label === "Location");
      expect(location).toBeDefined();
      expect(location!.entries.find((e) => e.key === "Latitude")?.value).toBe(
        "37.7749"
      );
    });

    it("should put country/admin fields in Location group", () => {
      const { groups } = formatEntityProperties({
        country_name: "United States"
      });

      const location = groups.find((g) => g.label === "Location");
      expect(location).toBeDefined();
      expect(location!.entries[0].value).toBe("United States");
    });
  });

  describe("STAC and agent metadata", () => {
    it("should add Source: STAC Catalog for stac_url data source", () => {
      const { groups } = formatEntityProperties({
        dataSource: "stac_url",
        createdBy: "agent"
      });

      const metadata = groups.find((g) => g.label === "Metadata");
      expect(metadata!.entries.find((e) => e.key === "Source")?.value).toBe(
        "STAC Catalog"
      );
    });

    it("should include createdBy and createdAt in metadata", () => {
      const { groups } = formatEntityProperties({
        createdBy: "agent",
        createdAt: "2024-06-15T12:00:00Z"
      });

      const metadata = groups.find((g) => g.label === "Metadata");
      expect(
        metadata!.entries.find((e) => e.key === "Created By")
      ).toBeDefined();
      expect(metadata!.entries.find((e) => e.key === "Created")).toBeDefined();
    });
  });

  describe("value formatting", () => {
    it("should format null/undefined as N/A", () => {
      const { groups } = formatEntityProperties({ custom_field: null });
      const details = groups.find((g) => g.label === "Details");
      expect(details!.entries[0].value).toBe("N/A");
    });

    it("should format integers without decimals", () => {
      const { groups } = formatEntityProperties({ count: 42 });
      const details = groups.find((g) => g.label === "Details");
      expect(details!.entries[0].value).toBe("42");
    });

    it("should format floats to 4 decimal places", () => {
      const { groups } = formatEntityProperties({ score: 0.123456789 });
      const details = groups.find((g) => g.label === "Details");
      expect(details!.entries[0].value).toBe("0.1235");
    });

    it("should format booleans as Yes/No", () => {
      const { groups } = formatEntityProperties({
        active: true,
        deleted: false
      });
      const details = groups.find((g) => g.label === "Details");
      expect(details!.entries.find((e) => e.value === "Yes")).toBeDefined();
      expect(details!.entries.find((e) => e.value === "No")).toBeDefined();
    });

    it("should truncate long strings", () => {
      const longStr = "x".repeat(150);
      const { groups } = formatEntityProperties({ note: longStr });
      const details = groups.find((g) => g.label === "Details");
      expect(details!.entries[0].value.length).toBeLessThan(150);
      expect(details!.entries[0].value).toContain("…");
    });

    it("should format arrays as comma-separated values", () => {
      const { groups } = formatEntityProperties({ tags: ["a", "b", "c"] });
      const details = groups.find((g) => g.label === "Details");
      expect(details!.entries[0].value).toBe("a, b, c");
    });

    it("should JSON.stringify objects", () => {
      const { groups } = formatEntityProperties({ nested: { a: 1 } });
      const details = groups.find((g) => g.label === "Details");
      expect(details!.entries[0].value).toBe('{"a":1}');
    });
  });

  describe("key formatting", () => {
    it("should convert camelCase to spaced words", () => {
      const { groups } = formatEntityProperties({ myCustomField: "val" });
      const details = groups.find((g) => g.label === "Details");
      expect(details!.entries[0].key).toBe("My Custom Field");
    });

    it("should convert snake_case to spaced words", () => {
      const { groups } = formatEntityProperties({ my_custom_field: "val" });
      const details = groups.find((g) => g.label === "Details");
      expect(details!.entries[0].key).toBe("My custom field");
    });
  });

  describe("skipped keys", () => {
    it("should skip internal keys like coordinates, geometry, type, style, id", () => {
      const { groups } = formatEntityProperties({
        coordinates: [0, 0],
        geometry: {},
        type: "Feature",
        style: {},
        id: "123",
        visible_field: "shown"
      });

      const allEntries = groups.flatMap((g) => g.entries);
      expect(allEntries.find((e) => e.key === "Coordinates")).toBeUndefined();
      expect(allEntries.find((e) => e.key === "Geometry")).toBeUndefined();
      expect(allEntries.find((e) => e.key === "Visible field")).toBeDefined();
    });
  });

  describe("empty groups", () => {
    it("should not include empty groups", () => {
      const { groups } = formatEntityProperties({});
      expect(groups).toHaveLength(0);
    });
  });

  describe("date/time routing", () => {
    it("should put date/time fields in Metadata group", () => {
      const { groups } = formatEntityProperties({
        created_date: "2024-01-01",
        update_time: "2024-06-15"
      });

      const metadata = groups.find((g) => g.label === "Metadata");
      expect(metadata).toBeDefined();
      expect(metadata!.entries).toHaveLength(2);
    });
  });
});
