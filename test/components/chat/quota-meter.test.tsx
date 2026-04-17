// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for QuotaMeter component.
 * Covers full/compact/minimal variants, high usage warnings, and reset timer.
 */

import { screen } from "@testing-library/react";

import { QuotaMeter } from "@/components/chat/quota-meter";
import { updateQuota } from "@/store/slices/bedrock-quota-slice";

import { createTestStore, renderWithStore } from "../../test-utils";

const sampleQuota = {
  has_limits: true,
  model_id: "model-a",
  limits: { requests_per_minute: 100, tokens_per_minute: 500000 },
  usage: { requests_used: 50, tokens_used: 250000, window_start: Date.now() },
  remaining: { requests: 50, tokens: 250000 },
  usage_percent: { requests: 50, tokens: 50 },
  reset_in_seconds: 45
};

describe("QuotaMeter", () => {
  it("should render nothing when no quota data", () => {
    const { container } = renderWithStore(<QuotaMeter modelId="unknown" />);
    expect(container.innerHTML).toBe("");
  });

  it("should render nothing when has_limits is false", () => {
    const store = createTestStore();
    store.dispatch(
      updateQuota({
        modelId: "m1",
        quotaInfo: { has_limits: false, model_id: "m1" }
      })
    );
    const { container } = renderWithStore(<QuotaMeter modelId="m1" />, {
      store
    });
    expect(container.innerHTML).toBe("");
  });

  it("should render full variant with quota details", () => {
    const store = createTestStore();
    store.dispatch(updateQuota({ modelId: "model-a", quotaInfo: sampleQuota }));

    renderWithStore(<QuotaMeter modelId="model-a" variant="full" />, { store });
    expect(screen.getByText("API Quota")).toBeInTheDocument();
    expect(screen.getAllByText(/remaining \/ limit/)).toHaveLength(2);
  });

  it("should render compact variant with progress bar only", () => {
    const store = createTestStore();
    store.dispatch(updateQuota({ modelId: "model-a", quotaInfo: sampleQuota }));

    renderWithStore(<QuotaMeter modelId="model-a" variant="compact" />, {
      store
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("should render minimal variant with chip", () => {
    const store = createTestStore();
    store.dispatch(updateQuota({ modelId: "model-a", quotaInfo: sampleQuota }));

    renderWithStore(<QuotaMeter modelId="model-a" variant="minimal" />, {
      store
    });
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("should show high usage warning at 80%+", () => {
    const store = createTestStore();
    store.dispatch(
      updateQuota({
        modelId: "model-a",
        quotaInfo: {
          ...sampleQuota,
          usage_percent: { requests: 85, tokens: 60 }
        }
      })
    );

    renderWithStore(<QuotaMeter modelId="model-a" variant="full" />, { store });
    expect(screen.getByText("High Usage")).toBeInTheDocument();
    expect(screen.getByText(/Approaching quota limit/)).toBeInTheDocument();
  });

  it("should show critical warning at 90%+", () => {
    const store = createTestStore();
    store.dispatch(
      updateQuota({
        modelId: "model-a",
        quotaInfo: {
          ...sampleQuota,
          usage_percent: { requests: 95, tokens: 60 }
        }
      })
    );

    renderWithStore(<QuotaMeter modelId="model-a" variant="full" />, { store });
    expect(screen.getByText(/Near quota limit/)).toBeInTheDocument();
  });

  it("should show reset timer when reset_in_seconds > 0", () => {
    const store = createTestStore();
    store.dispatch(updateQuota({ modelId: "model-a", quotaInfo: sampleQuota }));

    renderWithStore(<QuotaMeter modelId="model-a" variant="full" />, { store });
    expect(screen.getByText(/Resets in/)).toBeInTheDocument();
  });
});
