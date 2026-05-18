// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for QuotaConfigModal component.
 * Covers empty state, quota display, and model info.
 */

import { screen } from "@testing-library/react";

import { QuotaConfigModal } from "@/components/chat/quota-config-modal";
import {
  fetchAvailableModels,
  setSelectedModel
} from "@/store/slices/bedrock-model-slice";
import { updateQuota } from "@/store/slices/bedrock-quota-slice";

jest.mock("@/services/bedrock-service", () => ({
  bedrockModelsService: { getAvailableModels: jest.fn() }
}));

import { createTestStore, renderWithStore } from "../../test-utils";

describe("QuotaConfigModal", () => {
  it("should show empty state when no quotas", () => {
    renderWithStore(<QuotaConfigModal isOpen={true} onClose={jest.fn()} />);
    expect(
      screen.getByText("No quota information available yet.")
    ).toBeInTheDocument();
  });

  it("should show current model name", () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedModel({
        modelId: "claude-1",
        modelName: "Claude Sonnet",
        providerName: "Anthropic",
        inputModalities: ["TEXT"],
        outputModalities: ["TEXT"],
        supportsStreaming: true,
        supportsToolUse: true,
        modelLifecycle: "ACTIVE",
        customizationsSupported: [],
        inferenceTypesSupported: []
      })
    );

    renderWithStore(<QuotaConfigModal isOpen={true} onClose={jest.fn()} />, {
      store
    });
    expect(screen.getByText("Claude Sonnet")).toBeInTheDocument();
  });

  it("should display quota cards when quotas exist", () => {
    const store = createTestStore();
    const models = [
      {
        modelId: "claude-1",
        modelName: "Claude",
        providerName: "Anthropic",
        inputModalities: ["TEXT"],
        outputModalities: ["TEXT"],
        supportsStreaming: true,
        supportsToolUse: true,
        modelLifecycle: "ACTIVE",
        customizationsSupported: [],
        inferenceTypesSupported: []
      }
    ];
    store.dispatch(
      fetchAvailableModels.fulfilled(
        { models, preferredModelId: null } as never,
        "r",
        undefined
      )
    );
    store.dispatch(
      updateQuota({
        modelId: "claude-1",
        quotaInfo: {
          has_limits: true,
          model_id: "claude-1",
          limits: { requests_per_minute: 100, tokens_per_minute: 500000 },
          usage: {
            requests_used: 50,
            tokens_used: 250000,
            window_start: Date.now()
          },
          usage_percent: { requests: 50, tokens: 50 }
        }
      })
    );

    renderWithStore(<QuotaConfigModal isOpen={true} onClose={jest.fn()} />, {
      store
    });
    expect(screen.getByText("Requests per Minute")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("should show help section", () => {
    renderWithStore(<QuotaConfigModal isOpen={true} onClose={jest.fn()} />);
    expect(screen.getByText(/Quota Management/)).toBeInTheDocument();
  });

  it("should not render content when closed", () => {
    const { container } = renderWithStore(
      <QuotaConfigModal isOpen={false} onClose={jest.fn()} />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });
});
