// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for UserPreferencesModal component.
 */

import { fireEvent, screen } from "@testing-library/react";

import { UserPreferencesModal } from "@/components/modals/user-preferences-modal";
import { DEFAULT_PREFERRED_MODEL } from "@/config/bedrock-defaults";

import { createTestStore, renderWithStore } from "../../test-utils";

const setThemeMock = jest.fn();
let currentMockTheme: string | undefined = "system";

jest.mock("next-themes", () => ({
  useTheme: () => ({
    theme: currentMockTheme,
    setTheme: setThemeMock
  })
}));

beforeEach(() => {
  setThemeMock.mockClear();
  currentMockTheme = "system";
});

const makeBedrockModelState = (overrides: Record<string, unknown> = {}) =>
  ({
    availableModels: [
      {
        modelId: "us.anthropic.claude-opus-4-6-v1",
        modelName: "Claude Opus 4.6",
        providerName: "Anthropic",
        inputModalities: ["TEXT"],
        outputModalities: ["TEXT"],
        supportsStreaming: true,
        supportsToolUse: true,
        modelLifecycle: "ACTIVE",
        customizationsSupported: [] as string[],
        inferenceTypesSupported: [] as string[]
      },
      {
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        modelName: "Claude Sonnet 4.5",
        providerName: "Anthropic",
        inputModalities: ["TEXT"],
        outputModalities: ["TEXT"],
        supportsStreaming: true,
        supportsToolUse: true,
        modelLifecycle: "ACTIVE",
        customizationsSupported: [] as string[],
        inferenceTypesSupported: [] as string[]
      }
    ],
    selectedModel: null,
    isLoading: false,
    error: null,
    lastFetched: null,
    connectionStatus: "disconnected" as const,
    ...overrides
  }) as never;

describe("UserPreferencesModal", () => {
  it("renders modal header when open", () => {
    renderWithStore(
      <UserPreferencesModal isOpen={true} onOpenChange={jest.fn()} />
    );
    expect(screen.getByText("User Preferences")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    const { container } = renderWithStore(
      <UserPreferencesModal isOpen={false} onOpenChange={jest.fn()} />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("shows loading indicator while models are being fetched", () => {
    const store = createTestStore({
      bedrockModel: makeBedrockModelState({
        availableModels: [],
        isLoading: true
      })
    });
    renderWithStore(
      <UserPreferencesModal isOpen={true} onOpenChange={jest.fn()} />,
      { store }
    );
    expect(screen.getByText("Loading models")).toBeInTheDocument();
  });

  it("shows 'No models available' when the list is empty and not loading", () => {
    const store = createTestStore({
      bedrockModel: makeBedrockModelState({
        availableModels: [],
        isLoading: false
      })
    });
    renderWithStore(
      <UserPreferencesModal isOpen={true} onOpenChange={jest.fn()} />,
      { store }
    );
    expect(screen.getByText("No models available")).toBeInTheDocument();
  });

  it("renders the auto-zoom switch reflecting state", () => {
    renderWithStore(
      <UserPreferencesModal isOpen={true} onOpenChange={jest.fn()} />
    );
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("toggles auto-zoom when the switch is clicked", () => {
    const store = createTestStore();
    renderWithStore(
      <UserPreferencesModal isOpen={true} onOpenChange={jest.fn()} />,
      { store }
    );
    expect(store.getState().settings.autoZoomOnLayerToggle).toBe(true);
    fireEvent.click(screen.getByRole("switch"));
    expect(store.getState().settings.autoZoomOnLayerToggle).toBe(false);
  });

  it("restores defaults when the Restore defaults button is pressed", () => {
    const store = createTestStore({
      bedrockModel: makeBedrockModelState(),
      settings: {
        autoZoomOnLayerToggle: false,
        map: { dayNightEnabled: false },
        globe: {
          enableLighting: true,
          showGroundAtmosphere: true,
          showSkyAtmosphere: true,
          enableFog: true
        },
        preferredModel: {
          modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
          modelName: "Claude Sonnet 4.5"
        }
      }
    });
    renderWithStore(
      <UserPreferencesModal isOpen={true} onOpenChange={jest.fn()} />,
      { store }
    );
    fireEvent.click(screen.getByRole("button", { name: /restore defaults/i }));
    expect(store.getState().settings.preferredModel).toEqual(
      DEFAULT_PREFERRED_MODEL
    );
    expect(store.getState().settings.autoZoomOnLayerToggle).toBe(true);
    expect(setThemeMock).toHaveBeenCalledWith("system");
  });

  it("renders three theme radio options reflecting current theme", () => {
    currentMockTheme = "dark";
    renderWithStore(
      <UserPreferencesModal isOpen={true} onOpenChange={jest.fn()} />
    );
    const lightRadio = screen.getByRole("radio", { name: /light/i });
    const darkRadio = screen.getByRole("radio", { name: /dark/i });
    const systemRadio = screen.getByRole("radio", { name: /system/i });
    expect(lightRadio).toBeInTheDocument();
    expect(darkRadio).toBeInTheDocument();
    expect(systemRadio).toBeInTheDocument();
    expect(darkRadio).toBeChecked();
  });

  it("calls setTheme when a different theme is selected", () => {
    renderWithStore(
      <UserPreferencesModal isOpen={true} onOpenChange={jest.fn()} />
    );
    fireEvent.click(screen.getByRole("radio", { name: /light/i }));
    expect(setThemeMock).toHaveBeenCalledWith("light");
  });

  it("calls onOpenChange when Close is pressed", () => {
    const onOpenChange = jest.fn();
    renderWithStore(
      <UserPreferencesModal isOpen={true} onOpenChange={onOpenChange} />
    );
    fireEvent.click(screen.getByText("Close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
