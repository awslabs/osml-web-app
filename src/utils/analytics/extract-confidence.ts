// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Extracts and normalizes a confidence value from arbitrarily nested
 * GeoJSON feature properties.
 *
 * Walks nested properties up to 4 levels deep, searching for keys
 * containing "confidence", "conf", "probability", "prob", or "score"
 * (case-insensitive). Explicit confidence keys are preferred over the
 * generic "score" key. Values in (1, 100] are normalized by dividing
 * by 100 so the result is always in [0, 1].
 */

/** Keys that are considered explicit confidence indicators. */
const EXPLICIT_PATTERNS = ["confidence", "conf", "probability", "prob"];

/** Keys that are considered generic (lower priority). */
const GENERIC_PATTERNS = ["score"];

/** Maximum nesting depth to search (4 levels). */
const MAX_DEPTH = 4;

/**
 * Check whether a key (lowercased) matches any of the given patterns.
 */
function matchesAny(keyLower: string, patterns: string[]): boolean {
  return patterns.some((p) => keyLower === p);
}

/**
 * Normalize a raw numeric value to the [0, 1] range.
 * - Values in [0, 1] are returned as-is.
 * - Values in (1, 100] are divided by 100.
 * - All other values (negative, > 100, NaN) return undefined.
 */
function normalize(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (value < 0 || value > 100) return undefined;
  if (value <= 1) return value;
  return value / 100;
}

/**
 * Recursively walk `obj` collecting normalized confidence values into
 * the `explicit` and `generic` arrays.
 */
function walk(
  obj: Record<string, unknown>,
  depth: number,
  explicit: number[],
  generic: number[]
): void {
  if (depth > MAX_DEPTH) return;

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    const keyLower = key.toLowerCase();

    if (typeof val === "number") {
      const norm = normalize(val);
      if (norm !== undefined) {
        if (matchesAny(keyLower, EXPLICIT_PATTERNS)) {
          explicit.push(norm);
        } else if (matchesAny(keyLower, GENERIC_PATTERNS)) {
          generic.push(norm);
        }
      }
    } else if (
      val !== null &&
      val !== undefined &&
      typeof val === "object" &&
      !Array.isArray(val)
    ) {
      walk(val as Record<string, unknown>, depth + 1, explicit, generic);
    } else if (Array.isArray(val)) {
      // Walk into array elements (e.g., featureClasses: [{ score: 0.85 }])
      for (const item of val) {
        if (
          item !== null &&
          item !== undefined &&
          typeof item === "object" &&
          !Array.isArray(item)
        ) {
          walk(item as Record<string, unknown>, depth + 1, explicit, generic);
        }
      }
    }
  }
}

/**
 * Extract and normalize a confidence value from GeoJSON feature properties.
 *
 * @param properties - The feature's property bag.
 * @returns A number in [0, 1], or `undefined` if no confidence-like key is found.
 */
export function extractConfidence(
  properties: Record<string, unknown>
): number | undefined {
  const explicit: number[] = [];
  const generic: number[] = [];

  walk(properties, 1, explicit, generic);

  if (explicit.length > 0) {
    return Math.max(...explicit);
  }
  if (generic.length > 0) {
    return Math.max(...generic);
  }
  return undefined;
}
