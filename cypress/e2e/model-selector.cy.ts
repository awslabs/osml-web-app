// Copyright Amazon.com, Inc. or its affiliates.
describe("Model Selector", () => {
  beforeEach(() => {
    // Mock the Bedrock models API
    cy.mockBedrockModels();

    // Visit the map page (where chat interface is)
    cy.visit("/map");
  });

  it("should load and display available models", () => {
    // Wait for models API call
    cy.wait("@getModels");

    // Verify model selector is visible
    cy.get('[aria-label="Select AI Model"]').should("be.visible");

    // Click to open the dropdown
    cy.get('[aria-label="Select AI Model"]').click();

    // Verify Claude Sonnet 4.5 is in the list
    cy.contains("Claude Sonnet 4.5").should("be.visible");
  });

  it("should allow user to select a model from dropdown", () => {
    cy.wait("@getModels");

    // Open model selector
    cy.get('[aria-label="Select AI Model"]').click();

    // Select Claude Sonnet 4.5
    cy.contains("Claude Sonnet 4.5").click();

    // Verify selection is displayed
    cy.get('[aria-label="Select AI Model"]').should(
      "contain",
      "Claude Sonnet 4.5"
    );
  });

  it("should display selected model in the interface", () => {
    cy.wait("@getModels");

    // Open and select a model
    cy.get('[aria-label="Select AI Model"]').click();
    cy.contains("Claude Sonnet 4.5").click();

    // Verify the selected model is shown
    cy.get('[aria-label="Select AI Model"]')
      .should("be.visible")
      .and("contain", "Claude Sonnet 4.5");
  });

  it("should show refresh button", () => {
    cy.wait("@getModels");

    // Verify refresh button exists
    cy.get('[aria-label="Refresh models"]').should("be.visible");
  });

  it("should handle model refresh", () => {
    cy.wait("@getModels");

    // Click refresh button
    cy.get('[aria-label="Refresh models"]').click();

    // Should trigger another API call
    cy.wait("@getModels");
  });
});
