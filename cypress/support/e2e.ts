// Copyright Amazon.com, Inc. or its affiliates.
// Cypress E2E support file: global hooks and Bedrock mock commands.
import "./commands";

// Hide fetch/XHR logs to reduce noise
Cypress.on("log:added", (attrs) => {
  if (attrs.name === "request" || attrs.name === "xhr") {
    attrs.displayName = "API";
  }
});

// Next.js dev-mode emits hydration-mismatch errors on first paint (SSR'd auth /
// runtime-config differs from the client before React reconciles). React
// regenerates the tree on the client, so this is benign in dev and absent from
// a production build. Don't let it fail otherwise-passing specs.
Cypress.on("uncaught:exception", (err) => {
  if (
    /Hydration failed|server rendered HTML didn't match|Minified React error #(418|423|425)/.test(
      err.message
    )
  ) {
    return false;
  }
  return undefined;
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

// Mock GET /bedrock/models so the app can select a model and reach readiness.
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

// Mock a plain text chat reply (no tool use). The frontend parses
// `{ message, usage }` from POST /bedrock/chat (see BedrockResponse).
Cypress.Commands.add("mockBedrockText", (message?: string) => {
  cy.intercept("POST", "**/bedrock/chat", {
    statusCode: 200,
    body: {
      message: message ?? "This is a test response from Bedrock",
      usage: { inputTokens: 10, outputTokens: 20 }
    }
  }).as("sendChat");
});

// Script a deterministic tool call without relying on the LLM to choose it.
// The agent loop makes two POST /bedrock/chat calls: the first returns a
// `tool_use` (toolCalls + requiresToolExecution); after the tool executes the
// frontend posts the tool result and we return a plain text completion. A
// per-intercept counter distinguishes the two requests.
Cypress.Commands.add(
  "mockBedrockToolCall",
  (toolName: string, input: Record<string, unknown> = {}) => {
    let callCount = 0;

    cy.intercept("POST", "**/bedrock/chat", (req) => {
      callCount += 1;

      if (callCount === 1) {
        req.reply({
          statusCode: 200,
          body: {
            message: "",
            toolCalls: [
              {
                toolUseId: `cypress-tooluse-${toolName}`,
                name: toolName,
                input
              }
            ],
            requiresToolExecution: true,
            usage: { inputTokens: 10, outputTokens: 20 }
          }
        });
      } else {
        req.reply({
          statusCode: 200,
          body: {
            message: `Completed ${toolName}.`,
            usage: { inputTokens: 10, outputTokens: 5 }
          }
        });
      }
    }).as("sendChat");
  }
);

// TypeScript declarations for custom commands
declare global {
  namespace Cypress {
    interface Chainable {
      mockBedrockModels(models?: MockBedrockModel[]): Chainable<void>;
      mockBedrockText(message?: string): Chainable<void>;
      mockBedrockToolCall(
        toolName: string,
        input?: Record<string, unknown>
      ): Chainable<void>;
    }
  }
}

export {};
