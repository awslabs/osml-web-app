// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for FeaturePopup component.
 * Covers ML inference features, STAC features, agent features, and close button.
 */

import { fireEvent, render, screen } from "@testing-library/react";

import { FeaturePopup } from "@/components/map/feature-popup";

const makeFeature = (props: Record<string, unknown>) => ({
  getProperties: () => props
});

describe("FeaturePopup", () => {
  it("should render ML inference feature with detections", () => {
    const feature = makeFeature({
      center_latitude: 37.7749,
      center_longitude: -122.4194,
      featureClasses: [
        { iri: "building", score: 0.95 },
        { iri: "vehicle", score: 0.72 }
      ]
    });

    render(<FeaturePopup feature={feature} onClose={jest.fn()} />);

    expect(screen.getByText(/37\.774900/)).toBeInTheDocument();
    expect(screen.getByText(/building: 95\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/vehicle: 72\.0%/)).toBeInTheDocument();
  });

  it("should render STAC feature with description and source", () => {
    const feature = makeFeature({
      description: "Test STAC Item",
      dataSource: "stac_url",
      stacUrl: "https://stac.example.com/item-1",
      createdBy: "agent",
      createdAt: "2024-06-15T12:00:00Z"
    });

    render(<FeaturePopup feature={feature} onClose={jest.fn()} />);

    expect(screen.getByText("Test STAC Item")).toBeInTheDocument();
    expect(screen.getByText("STAC Catalog Item")).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();
  });

  it("should render country codes and administrative group", () => {
    const feature = makeFeature({
      name: "France",
      countryA2: "FR",
      countryA3: "FRA",
      administrativeGroup: "European Union"
    });

    render(<FeaturePopup feature={feature} onClose={jest.fn()} />);

    expect(screen.getByText("France")).toBeInTheDocument();
    expect(screen.getByText(/FR/)).toBeInTheDocument();
    expect(screen.getByText(/FRA/)).toBeInTheDocument();
    expect(screen.getByText("European Union")).toBeInTheDocument();
  });

  it("should render data_type and type fields", () => {
    const feature = makeFeature({
      type: "polygon",
      data_type: "administrative"
    });

    render(<FeaturePopup feature={feature} onClose={jest.fn()} />);

    expect(screen.getByText("polygon")).toBeInTheDocument();
    expect(screen.getByText("administrative")).toBeInTheDocument();
  });

  it("should call onClose when close button clicked", () => {
    const onClose = jest.fn();
    const feature = makeFeature({ description: "Test" });

    render(<FeaturePopup feature={feature} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
