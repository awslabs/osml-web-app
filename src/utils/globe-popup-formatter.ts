// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Formats raw Cesium entity properties into structured groups for the
 * GlobeFeaturePopup. Handles ML detection features, STAC catalog items,
 * and agent-drawn features.
 */

import type {
  PopupEntry,
  PopupGroup
} from "@/components/globe/globe-feature-popup";

// Keys to skip — internal/geometry data that isn't useful in a popup
const SKIP_KEYS = new Set([
  "coordinates",
  "geometry",
  "type",
  "bbox",
  "bounds",
  "shape",
  "style",
  "id"
]);

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toString() : value.toFixed(4);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "string") {
    // Try to format ISO dates
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      try {
        return new Date(value).toLocaleString();
      } catch {
        /* keep original */
      }
    }
    return value.length > 100 ? value.substring(0, 100) + "…" : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => formatValue(v)).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

/**
 * Build popup groups from raw entity properties.
 * Returns { title, groups } where title is the best display name found.
 *
 * @param props - Raw entity properties
 * @param entityName - Optional entity name; detection entities use the
 *   pattern "jobId::entityId" so we can extract the source job.
 */
export function formatEntityProperties(
  props: Record<string, unknown>,
  entityName?: string
): {
  title: string;
  groups: PopupGroup[];
} {
  const detection: PopupEntry[] = [];
  const location: PopupEntry[] = [];
  const metadata: PopupEntry[] = [];
  const details: PopupEntry[] = [];

  // Determine title
  const title =
    (props.description as string) ||
    (props.name as string) ||
    (props.title as string) ||
    "Feature";

  // Extract job ID from entity name pattern "jobId::entityId"
  let detectionJobId: string | undefined;
  if (entityName && entityName.includes("::")) {
    detectionJobId = entityName.split("::")[0];
  }

  // Handle ML detection feature classes
  const featureClasses = props.featureClasses as
    | Array<{ iri: string; score: number }>
    | undefined;
  if (featureClasses && Array.isArray(featureClasses)) {
    for (const fc of featureClasses) {
      detection.push({ key: "Class", value: String(fc.iri) });
      detection.push({
        key: "Score",
        value: `${(fc.score * 100).toFixed(1)}%`
      });
    }
  }

  // Handle inference metadata
  const inferenceMetadata = props.inferenceMetadata as
    | { jobId?: string; inferenceDT?: string }
    | undefined;
  if (inferenceMetadata && typeof inferenceMetadata === "object") {
    if (inferenceMetadata.jobId) {
      metadata.push({ key: "Job ID", value: inferenceMetadata.jobId });
    }
    if (inferenceMetadata.inferenceDT) {
      metadata.push({
        key: "Inference Time",
        value: formatValue(inferenceMetadata.inferenceDT)
      });
    }
  }

  // Location entries
  if (props.center_latitude !== undefined) {
    location.push({
      key: "Latitude",
      value: formatValue(props.center_latitude)
    });
  }
  if (props.center_longitude !== undefined) {
    location.push({
      key: "Longitude",
      value: formatValue(props.center_longitude)
    });
  }

  // Iterate remaining properties
  for (const [key, value] of Object.entries(props)) {
    const lower = key.toLowerCase();
    if (SKIP_KEYS.has(lower)) continue;
    if (
      [
        "featureclasses",
        "inferencemetadata",
        "center_latitude",
        "center_longitude",
        "description",
        "createdby",
        "createdat",
        "stacurl",
        "datasource",
        "hasimagery",
        "viewpointid",
        "viewpointstatus",
        "imagegeometry"
      ].includes(lower)
    )
      continue;

    const entry: PopupEntry = {
      key: formatKey(key),
      value: formatValue(value)
    };

    if (lower.includes("date") || lower.includes("time")) {
      metadata.push(entry);
    } else if (lower.includes("country") || lower.includes("admin")) {
      location.push(entry);
    } else {
      details.push(entry);
    }
  }

  // Add detection job ID if extracted from entity name
  if (detectionJobId) {
    metadata.push({ key: "Job ID", value: detectionJobId });
  }

  // Add source info for STAC items
  if (props.dataSource === "stac_url") {
    metadata.push({ key: "Source", value: "STAC Catalog" });
  }
  if (props.createdBy) {
    metadata.push({
      key: "Created By",
      value: formatValue(props.createdBy)
    });
  }
  if (props.createdAt) {
    metadata.push({
      key: "Created",
      value: formatValue(props.createdAt)
    });
  }

  // Build groups, only include non-empty ones
  const groups: PopupGroup[] = [];
  if (detection.length > 0)
    groups.push({ label: "Classification", entries: detection });
  if (location.length > 0)
    groups.push({ label: "Location", entries: location });
  if (details.length > 0) groups.push({ label: "Details", entries: details });
  if (metadata.length > 0)
    groups.push({ label: "Metadata", entries: metadata });

  return { title, groups };
}
