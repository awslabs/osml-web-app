// Copyright Amazon.com, Inc. or its affiliates.
// Cypress E2E support file
// Import commands.js using ES2015 syntax:
import "./commands";

// Alternatively you can use CommonJS syntax:
// require('./commands')

// Hide fetch/XHR logs to reduce noise
Cypress.on("log:added", (attrs) => {
  if (attrs.name === "request" || attrs.name === "xhr") {
    attrs.displayName = "API";
  }
});

interface MockBedrockModel {
  modelId: string;
  modelName: string;
  providerName: string;
  inputModalities: string[];
  outputModalities: string[];
  supportsStreaming: boolean;
  supportsToolUse: boolean;
  modelLifecycle: string;
  customizationsSupported: string[];
  inferenceTypesSupported: string[];
}

interface MockBedrockChatResponse {
  message: string;
  usage?: { inputTokens: number; outputTokens: number };
}

// Custom command to intercept Bedrock API calls
Cypress.Commands.add("mockBedrockModels", (models?: MockBedrockModel[]) => {
  const defaultModels: MockBedrockModel[] = models || [
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
    }
  ];

  cy.intercept("GET", "**/bedrock/models", {
    statusCode: 200,
    body: { models: defaultModels }
  }).as("getModels");
});

Cypress.Commands.add(
  "mockBedrockChat",
  (response?: MockBedrockChatResponse) => {
    const defaultResponse: MockBedrockChatResponse = response || {
      message: "This is a test response from Bedrock",
      usage: { inputTokens: 10, outputTokens: 20 }
    };

    cy.intercept("POST", "**/bedrock/chat", {
      statusCode: 200,
      body: defaultResponse
    }).as("sendChat");
  }
);

// TypeScript declarations for custom commands
declare global {
  namespace Cypress {
    interface Chainable {
      mockBedrockModels(models?: MockBedrockModel[]): Chainable<void>;
      mockBedrockChat(response?: MockBedrockChatResponse): Chainable<void>;
    }
  }
}

export {};
