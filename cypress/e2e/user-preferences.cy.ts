// Copyright Amazon.com, Inc. or its affiliates.
/**
 * User preferences modal (opened from the navbar): preferred chat model, color
 * theme, and restore-defaults. The auto-zoom switch is covered by viewport.cy.ts.
 */
import { getState, store } from "../support/helpers";

// Two models so "preferred" is a real choice, not just the auto-selected first.
const MODELS = [
  {
    modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    modelName: "Claude Sonnet 4.5",
    providerName: "Anthropic",
    inputModalities: ["TEXT"],
    outputModalities: ["TEXT"],
    supportsStreaming: true,
    supportsToolUse: true,
    modelLifecycle: "ACTIVE",
    customizationsSupported: [],
    inferenceTypesSupported: ["INFERENCE_PROFILE"]
  },
  {
    modelId: "us.anthropic.claude-opus-4-5-20251101-v1:0",
    modelName: "Claude Opus 4.5",
    providerName: "Anthropic",
    inputModalities: ["TEXT"],
    outputModalities: ["TEXT"],
    supportsStreaming: true,
    supportsToolUse: true,
    modelLifecycle: "ACTIVE",
    customizationsSupported: [],
    inferenceTypesSupported: ["INFERENCE_PROFILE"]
  }
];

function openPreferences() {
  cy.visit("/map");
  cy.wait("@getModels");
  cy.get('[aria-label="User preferences"]', { timeout: 15000 }).click();
  cy.contains("User Preferences", { timeout: 10000 }).should("be.visible");
}

describe("User preferences", () => {
  beforeEach(() => {
    cy.loginBypass();
    cy.mockBedrockModels(MODELS);
  });

  it("changes and persists the preferred chat model", () => {
    openPreferences();

    // Open the preferred-model Select via keyboard (the React-Aria listbox is
    // flaky to open by click headless) and pick the non-default model.
    cy.get('button[aria-label="Preferred chat model"]', { timeout: 15000 })
      .focus()
      .type("{enter}");
    cy.contains('[role="option"]', "Claude Opus 4.5", { timeout: 10000 })
      .should("have.length.greaterThan", 0)
      .click();

    // settings.preferredModel updates and survives a reload (persisted slice).
    getState()
      .its("settings.preferredModel.modelId")
      .should("eq", "us.anthropic.claude-opus-4-5-20251101-v1:0");

    cy.reload();
    cy.window().its("__OSML_STORE__", { timeout: 15000 }).should("exist");
    getState()
      .its("settings.preferredModel.modelId")
      .should("eq", "us.anthropic.claude-opus-4-5-20251101-v1:0");
  });

  it("switches the color theme to dark", () => {
    openPreferences();

    cy.contains("label", "Dark").click();

    // next-themes applies the theme as a class on <html> and stores it.
    cy.get("html").should("have.class", "dark");
    cy.window()
      .its("localStorage")
      .invoke("getItem", "theme")
      .should("eq", "dark");
  });

  it("restores defaults (model, auto-zoom, theme) in one action", () => {
    openPreferences();

    // Move everything off its default first.
    cy.contains("label", "Dark").click();
    cy.get("#auto-zoom-switch").click();
    getState().its("settings.autoZoomOnLayerToggle").should("eq", false);

    cy.contains("button", "Restore defaults").click();

    // auto-zoom back to true, theme back to system (html no longer .dark).
    getState().its("settings.autoZoomOnLayerToggle").should("eq", true);
    cy.window()
      .its("localStorage")
      .invoke("getItem", "theme")
      .should("eq", "system");
    store()
      .invoke("getState")
      .its("settings.preferredModel")
      .should("not.be.null");
  });
});

export {};
