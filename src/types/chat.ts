// Copyright Amazon.com, Inc. or its affiliates.
// Chat message and session types
export enum MessageType {
  HUMAN = "human",
  AI = "assistant",
  TOOL = "tool",
  SYSTEM = "system"
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  type?: string;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  content: string;
  status?: "success" | "error";
}

/**
 * Returned by destructive tool handlers in lieu of acting. The tool chain
 * pauses, shows the user an inline confirmation card, and runs the actual
 * deletion only after explicit confirmation.
 */
export interface ConfirmationRequiredPayload {
  confirmationRequired: true;
  action:
    | "delete_stac_collection"
    | "delete_stac_item"
    | "delete_image_processing_job";
  args: Record<string, unknown>;
  title: string;
  message: string;
  warning?: string;
}

export interface MessageMetadata {
  toolCallId?: string;
  toolName?: string;
  isToolResult?: boolean;
  args?: Record<string, unknown>;
  throttleData?: {
    retryAfterSeconds: number;
    errorType: string;
    limitType: string;
    isPermanent: boolean;
  };
  [key: string]: unknown;
}

export class ChatMessage {
  public id: string;
  public type: MessageType;
  public content: string;
  public timestamp: Date;
  public toolCalls?: ToolCall[];
  public toolResults?: ToolResult[];
  public metadata: MessageMetadata;
  public canRetry?: boolean;
  public error?: string;

  constructor(data: {
    type: MessageType;
    content: string;
    metadata?: MessageMetadata;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    canRetry?: boolean;
    error?: string;
  }) {
    this.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    this.type = data.type;
    this.content = data.content;
    this.timestamp = new Date();
    this.toolCalls = data.toolCalls || [];
    this.toolResults = data.toolResults || [];
    this.metadata = data.metadata || {};
    this.canRetry = data.canRetry;
    this.error = data.error;
  }
}

export interface ChatSession {
  sessionId: string;
  history: ChatMessage[];
  isProcessing: boolean;
  lastProcessedMessageIndex: number;
  errors: string[];
  notifications: {
    type: "info" | "warning" | "error";
    message: string;
    timestamp: Date;
  }[];
}

export interface ToolExecutionStatus {
  toolName: string;
  status: "executing" | "completed" | "failed";
  result?: string;
  error?: string;
  startTime?: Date;
  endTime?: Date;
}
