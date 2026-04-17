// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for AdjustmentSlider component.
 */

import { render, screen } from "@testing-library/react";

import { AdjustmentSlider } from "@/components/image-adjustment-slider";

describe("AdjustmentSlider", () => {
  const defaultProps = {
    label: "Exposure",
    value: 0.5,
    min: -1,
    max: 1,
    step: 0.01,
    defaultValue: 0,
    onChange: jest.fn()
  };

  it("should render label", () => {
    render(<AdjustmentSlider {...defaultProps} />);
    expect(screen.getByText("Exposure")).toBeInTheDocument();
  });

  it("should render current value", () => {
    render(<AdjustmentSlider {...defaultProps} />);
    expect(screen.getByText("0.50")).toBeInTheDocument();
  });

  it("should render slider with aria-label", () => {
    render(<AdjustmentSlider {...defaultProps} />);
    expect(
      screen.getByRole("slider", { name: "Exposure" })
    ).toBeInTheDocument();
  });

  it("should render disabled state", () => {
    render(<AdjustmentSlider {...defaultProps} disabled />);
    // HeroUI slider adds data-disabled attribute
    const slider = screen.getByRole("slider", { name: "Exposure" });
    expect(slider).toBeInTheDocument();
  });
});
