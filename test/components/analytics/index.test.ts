// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for analytics barrel export.
 */

jest.mock("@/contexts/auto-adjust-context", () => ({
  useAutoAdjust: () => null
}));

import {
  AnalyticsPanel,
  ClassificationChart,
  ColorModeSelector,
  ComparisonView,
  ConfidenceHistogram,
  ConfidenceSlider,
  FilterChips
} from "@/components/analytics";

describe("analytics/index", () => {
  it("should export all analytics components", () => {
    expect(AnalyticsPanel).toBeDefined();
    expect(ConfidenceHistogram).toBeDefined();
    expect(ClassificationChart).toBeDefined();
    expect(FilterChips).toBeDefined();
    expect(ColorModeSelector).toBeDefined();
    expect(ConfidenceSlider).toBeDefined();
    expect(ComparisonView).toBeDefined();
  });
});
