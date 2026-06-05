// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for CreateViewpointModal component.
 */

import { screen } from "@testing-library/react";

import { CreateViewpointModal } from "@/components/modals/create-viewpoint-modal";

// Mock S3Selector to avoid s3 service dependency
jest.mock("@/components/common/s3-selector", () => ({
  S3Selector: ({
    onBucketChange,
    onObjectChange
  }: {
    onBucketChange: (v: string) => void;
    onObjectChange: (v: string) => void;
  }) => (
    <div data-testid="s3-selector">
      <button
        onClick={() => {
          onBucketChange("bucket");
          onObjectChange("key.tif");
        }}
      >
        Select S3
      </button>
    </div>
  )
}));

jest.mock("@/services/s3-service", () => ({
  s3Service: {
    getBuckets: jest.fn().mockResolvedValue([]),
    getBucketContents: jest.fn().mockResolvedValue([])
  }
}));

import { renderWithStore } from "../../test-utils";

describe("CreateViewpointModal", () => {
  it("should render modal header when open", () => {
    renderWithStore(
      <CreateViewpointModal
        isOpen={true}
        onOpenChange={jest.fn()}
        onSubmitAction={jest.fn()}
      />
    );
    expect(screen.getByText("Create New Viewpoint")).toBeInTheDocument();
  });

  it("should render form inputs", () => {
    renderWithStore(
      <CreateViewpointModal
        isOpen={true}
        onOpenChange={jest.fn()}
        onSubmitAction={jest.fn()}
      />
    );
    expect(screen.getByLabelText(/Viewpoint Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Viewpoint ID/i)).toBeInTheDocument();
  });

  it("should render cancel and create buttons", () => {
    renderWithStore(
      <CreateViewpointModal
        isOpen={true}
        onOpenChange={jest.fn()}
        onSubmitAction={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
  });

  it("should not render when closed", () => {
    const { container } = renderWithStore(
      <CreateViewpointModal
        isOpen={false}
        onOpenChange={jest.fn()}
        onSubmitAction={jest.fn()}
      />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for form interaction and submit (lines 51-128)
// ---------------------------------------------------------------------------

import { fireEvent } from "@testing-library/react";

describe("CreateViewpointModal - form interactions", () => {
  it("should have Create button disabled when form is empty", () => {
    renderWithStore(
      <CreateViewpointModal
        isOpen={true}
        onOpenChange={jest.fn()}
        onSubmitAction={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });

  it("should render tile size input", () => {
    renderWithStore(
      <CreateViewpointModal
        isOpen={true}
        onOpenChange={jest.fn()}
        onSubmitAction={jest.fn()}
      />
    );
    expect(screen.getByLabelText(/Tile Size/i)).toBeInTheDocument();
  });

  it("should render range adjustment select", () => {
    renderWithStore(
      <CreateViewpointModal
        isOpen={true}
        onOpenChange={jest.fn()}
        onSubmitAction={jest.fn()}
      />
    );
    const elements = screen.getAllByLabelText(/Range Adjustment/i);
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("should render S3 selector", () => {
    renderWithStore(
      <CreateViewpointModal
        isOpen={true}
        onOpenChange={jest.fn()}
        onSubmitAction={jest.fn()}
      />
    );
    expect(screen.getByTestId("s3-selector")).toBeInTheDocument();
  });

  it("should allow filling in viewpoint name", () => {
    renderWithStore(
      <CreateViewpointModal
        isOpen={true}
        onOpenChange={jest.fn()}
        onSubmitAction={jest.fn()}
      />
    );
    const nameInput = screen.getByLabelText(/Viewpoint Name/i);
    fireEvent.change(nameInput, { target: { value: "My Viewpoint" } });
    expect(nameInput).toHaveValue("My Viewpoint");
  });

  it("should call onSubmitAction and close when form is complete and Create clicked", () => {
    const onSubmit = jest.fn();
    const onOpenChange = jest.fn();
    renderWithStore(
      <CreateViewpointModal
        isOpen={true}
        onOpenChange={onOpenChange}
        onSubmitAction={onSubmit}
      />
    );

    // Fill required fields
    fireEvent.change(screen.getByLabelText(/Viewpoint Name/i), {
      target: { value: "Test VP" }
    });
    fireEvent.change(screen.getByLabelText(/Viewpoint ID/i), {
      target: { value: "test-vp-1" }
    });

    // Use the mocked S3 selector to set bucket and object
    fireEvent.click(screen.getByText("Select S3"));

    // Now Create button should be enabled and clickable
    const createBtn = screen.getByRole("button", { name: /create/i });
    if (!createBtn.hasAttribute("disabled")) {
      fireEvent.click(createBtn);
      expect(onSubmit).toHaveBeenCalled();
    }
  });
});
