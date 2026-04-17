// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Extracts a classification label from GeoJSON feature properties.
 *
 * Follows a priority chain:
 * 1. `feature_classes` / `featureClasses` array — returns the `iri` of the first item.
 * 2. Top-level string properties with classification-like keys (case-insensitive).
 * 3. One level of nested object search for classification-like string keys.
 * 4. Returns `undefined` if nothing is found.
 */

/** Classification-like key patterns matched case-insensitively. */
const CLASSIFICATION_PATTERNS = [
  "classification",
  "class",
  "category",
  "label",
  "featureclassiri"
];

/**
 * Check whether a lowercased key matches any classification pattern.
 */
function isClassificationKey(keyLower: string): boolean {
  return CLASSIFICATION_PATTERNS.some((p) => keyLower === p);
}

/**
 * Try to extract an `iri` string from a `feature_classes` or `featureClasses` array.
 * Returns the first valid `iri` string, or `undefined`.
 */
function extractFromFeatureClasses(
  properties: Record<string, unknown>
): string | undefined {
  const arr =
    (properties["feature_classes"] as unknown[] | undefined) ??
    (properties["featureClasses"] as unknown[] | undefined);

  if (!Array.isArray(arr) || arr.length === 0) return undefined;

  for (const item of arr) {
    if (
      item !== null &&
      item !== undefined &&
      typeof item === "object" &&
      !Array.isArray(item)
    ) {
      const iri = (item as Record<string, unknown>)["iri"];
      if (typeof iri === "string") return iri;
    }
  }
  return undefined;
}

/**
 * Search top-level string properties for a classification-like key.
 */
function extractFromTopLevel(
  properties: Record<string, unknown>
): string | undefined {
  for (const key of Object.keys(properties)) {
    if (isClassificationKey(key.toLowerCase())) {
      const val = properties[key];
      if (typeof val === "string") return val;
    }
  }
  return undefined;
}

/**
 * Search one level into nested objects for a classification-like string key.
 */
function extractFromNested(
  properties: Record<string, unknown>
): string | undefined {
  for (const key of Object.keys(properties)) {
    const val = properties[key];
    if (
      val !== null &&
      val !== undefined &&
      typeof val === "object" &&
      !Array.isArray(val)
    ) {
      const nested = val as Record<string, unknown>;
      for (const nestedKey of Object.keys(nested)) {
        if (isClassificationKey(nestedKey.toLowerCase())) {
          const nestedVal = nested[nestedKey];
          if (typeof nestedVal === "string") return nestedVal;
        }
      }
    }
  }
  return undefined;
}

/**
 * Extract a classification label from GeoJSON feature properties.
 *
 * @param properties - The feature's property bag.
 * @returns A classification string, or `undefined` if none is found.
 */
export function extractClassification(
  properties: Record<string, unknown>
): string | undefined {
  // 1. feature_classes / featureClasses array with iri field
  const fromFeatureClasses = extractFromFeatureClasses(properties);
  if (fromFeatureClasses !== undefined) return fromFeatureClasses;

  // 2. Top-level classification-like string keys
  const fromTopLevel = extractFromTopLevel(properties);
  if (fromTopLevel !== undefined) return fromTopLevel;

  // 3. One level of nested object search
  return extractFromNested(properties);
}
