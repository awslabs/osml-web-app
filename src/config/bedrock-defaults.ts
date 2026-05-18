// Copyright Amazon.com, Inc. or its affiliates.

/**
 * A reference to a Bedrock model, kept in user preferences. Stores both the
 * model ID (used for matching against the available-models list) and the
 * friendly name (used for display, including when the model is no longer
 * available and the full `BedrockModel` cannot be looked up).
 */
export interface PreferredModelRef {
  modelId: string;
  modelName: string;
}

/**
 * Client-side default for Bedrock chat. Applied on first load when the user
 * has not yet expressed a preference. If the default model is not in the
 * deployment's enabled-models list, `selectDefaultBedrockModel` falls through
 * to the first available model.
 */
export const DEFAULT_PREFERRED_MODEL: PreferredModelRef = {
  modelId: "us.anthropic.claude-opus-4-6-v1",
  modelName: "Claude Opus 4.6"
};
