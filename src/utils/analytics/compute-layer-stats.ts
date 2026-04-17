// Copyright Amazon.com, Inc. or its affiliates.
import { FeatureRecord, LayerStats } from "./types";

/**
 * Aggregates statistics for a set of feature records given a confidence threshold.
 *
 * Produces a 10-bin confidence histogram, visible/total counts,
 * average confidence, classification counts, and unknown/unclassified tallies.
 */
export function computeLayerStats(
  records: FeatureRecord[],
  confidenceThreshold: number
): LayerStats {
  const confidenceHistogram = new Array<number>(10).fill(0);
  const classificationCounts: Record<string, number> = Object.create(
    null
  ) as Record<string, number>;

  let visibleCount = 0;
  let unknownConfidenceCount = 0;
  let unclassifiedCount = 0;
  let confidenceSum = 0;
  let definedConfidenceCount = 0;

  for (const record of records) {
    // Histogram and confidence aggregation
    if (record.confidence !== undefined) {
      const bin = Math.min(Math.floor(record.confidence * 10), 9);
      confidenceHistogram[bin]++;
      confidenceSum += record.confidence;
      definedConfidenceCount++;
    } else {
      unknownConfidenceCount++;
    }

    // Visible count: confidence >= threshold or undefined confidence
    if (
      record.confidence === undefined ||
      record.confidence >= confidenceThreshold
    ) {
      visibleCount++;
    }

    // Classification counts
    if (record.classification !== undefined) {
      classificationCounts[record.classification] =
        (classificationCounts[record.classification] ?? 0) + 1;
    } else {
      unclassifiedCount++;
    }
  }

  const avgConfidence =
    definedConfidenceCount > 0
      ? confidenceSum / definedConfidenceCount
      : undefined;

  return {
    totalCount: records.length,
    visibleCount,
    classificationCounts,
    confidenceHistogram,
    avgConfidence,
    unknownConfidenceCount,
    unclassifiedCount
  };
}
