// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { utilityApiClient } from "../utils/api-client";

// MCP Tool interfaces
export interface BedrockToolCall {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
}

export interface BedrockToolResult {
  toolUseId: string;
  content: Array<{
    text?: string;
    document?: {
      format: string;
      name: string;
      source: {
        bytes: string;
      };
    };
  }>;
  status?: "success" | "error";
}

// ===== MODELS SERVICE TYPES & INTERFACES =====

export interface BedrockModel {
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

interface BedrockModelsResponse {
  models: BedrockModel[];
}

// ===== CHAT SERVICE TYPES & INTERFACES =====

export interface BedrockResponse {
  message: string;
  toolCalls?: BedrockToolCall[];
  requiresToolExecution?: boolean;
  usage?: {
    inputTokens: number; // Raw input tokens (1:1 burndown)
    outputTokens: number; // Raw output tokens (5:1 burndown applied by backend for quota tracking)
  };
}

// ===== CHAT REQUEST TYPES =====

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  modelId: string;
  maxTokens: number;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
}

// ===== QUOTA TYPES =====

interface QuotaInfo {
  has_limits: boolean;
  model_id: string;
  limits?: {
    requests_per_minute: number;
    tokens_per_minute: number;
  };
  usage?: {
    requests_used: number;
    tokens_used: number;
    window_start: number;
  };
  remaining?: {
    requests: number;
    tokens: number;
  };
  usage_percent?: {
    requests: number;
    tokens: number;
  };
  reset_in_seconds?: number;
}

// ===== BEDROCK SERVICE =====

class BedrockService {
  /**
   * Fetch all available Bedrock models that support text
   */
  async getAvailableModels(): Promise<BedrockModel[]> {
    const data: BedrockModelsResponse =
      await utilityApiClient.get("/bedrock/models");

    return data.models;
  }

  /**
   * Get a display name for a model
   */
  getModelDisplayName(model: BedrockModel): string {
    return model.modelName || model.modelId;
  }

  /**
   * Send a chat message to Bedrock and get a response
   */
  async sendChatMessage(request: ChatRequest): Promise<BedrockResponse> {
    return await utilityApiClient.post("/bedrock/chat", request);
  }

  /**
   * Test connection to Bedrock service
   */
  async testConnection(): Promise<{
    status: string;
    models_available: number;
  }> {
    return await utilityApiClient.post("/bedrock/test-connection");
  }

  /**
   * Get quota status for a specific model
   */
  async getModelQuota(modelId: string): Promise<QuotaInfo> {
    const encodedModelId = encodeURIComponent(modelId);

    return await utilityApiClient.get(`/bedrock/quota/${encodedModelId}`);
  }

  /**
   * Get quota status for all models
   */
  async getQuotas(): Promise<{
    quota_tracking_enabled: boolean;
    models: Record<string, QuotaInfo>;
  }> {
    return await utilityApiClient.get("/bedrock/quota");
  }
}

// ===== SERVICE INSTANCE =====

export const bedrockService = new BedrockService();

// Convenience aliases used across the codebase
export const bedrockModelsService = bedrockService;
export const bedrockChatService = bedrockService;
export const bedrockQuotaService = bedrockService;
