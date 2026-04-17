// Copyright Amazon.com, Inc. or its affiliates.
import { createSelector, createSlice, PayloadAction } from "@reduxjs/toolkit";

import {
  ChatMessage,
  ChatSession,
  MessageType,
  ToolCall,
  ToolResult
} from "@/types/chat";

// Plain object interface for Redux (serializable)
interface SerializableChatMessage {
  id: string;
  type: MessageType;
  content: string;
  timestamp: string; // ISO string instead of Date object
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  metadata?: Record<string, unknown>;
  canRetry?: boolean;
  error?: string;
}

// Serializable session interface
interface SerializableChatSession {
  sessionId: string;
  history: SerializableChatMessage[];
  isProcessing: boolean;
  lastProcessedMessageIndex: number;
  errors: string[];
  notifications: {
    type: "info" | "warning" | "error";
    message: string;
    timestamp: string; // ISO string instead of Date object
  }[];
}

// Global chat session state - shared across all pages
interface ChatSessionState extends SerializableChatSession {
  lastUserActivity: number; // Timestamp of last user interaction
}

const initialState: ChatSessionState = {
  sessionId: `session-${Date.now()}`,
  history: [],
  isProcessing: false,
  lastProcessedMessageIndex: -1,
  errors: [],
  notifications: [],
  lastUserActivity: Date.now()
};

// Helper to convert ChatMessage class to plain object
const messageToSerializable = (
  message: ChatMessage
): SerializableChatMessage => ({
  id: message.id,
  type: message.type,
  content: message.content,
  timestamp: message.timestamp.toISOString(),
  toolCalls: message.toolCalls,
  toolResults: message.toolResults,
  metadata: message.metadata,
  canRetry: message.canRetry,
  error: message.error
});

// Helper to convert plain object back to ChatMessage class
export const serializableToMessage = (
  serializable: SerializableChatMessage
): ChatMessage => {
  const message = new ChatMessage({
    type: serializable.type,
    content: serializable.content,
    metadata: serializable.metadata,
    toolCalls: serializable.toolCalls,
    toolResults: serializable.toolResults,
    canRetry: serializable.canRetry,
    error: serializable.error
  });

  // Restore original id and timestamp
  message.id = serializable.id;
  message.timestamp = new Date(serializable.timestamp);

  return message;
};

const chatSessionSlice = createSlice({
  name: "chatSession",
  initialState,
  reducers: {
    addMessage: (state, action: PayloadAction<SerializableChatMessage>) => {
      state.history.push(action.payload);
    },

    addMessages: (state, action: PayloadAction<SerializableChatMessage[]>) => {
      state.history.push(...action.payload);
    },

    removeMessage: (state, action: PayloadAction<string>) => {
      state.history = state.history.filter((msg) => msg.id !== action.payload);
    },

    updateMessage: (
      state,
      action: PayloadAction<{
        id: string;
        updates: Partial<SerializableChatMessage>;
      }>
    ) => {
      const { id, updates } = action.payload;
      const messageIndex = state.history.findIndex((msg) => msg.id === id);

      if (messageIndex !== -1) {
        state.history[messageIndex] = {
          ...state.history[messageIndex],
          ...updates
        };
      }
    },

    clearHistory: (state) => {
      state.history = [];
      state.lastProcessedMessageIndex = -1;
      state.errors = [];
      state.notifications = [];
    },

    setProcessing: (state, action: PayloadAction<boolean>) => {
      state.isProcessing = action.payload;
    },

    setLastProcessedMessageIndex: (state, action: PayloadAction<number>) => {
      state.lastProcessedMessageIndex = action.payload;
    },

    addError: (state, action: PayloadAction<string>) => {
      state.errors.push(action.payload);
    },

    clearErrors: (state) => {
      state.errors = [];
    },

    addNotification: (
      state,
      action: PayloadAction<{
        type: "info" | "warning" | "error";
        message: string;
        timestamp: string;
      }>
    ) => {
      state.notifications.push(action.payload);
    },

    clearNotifications: (state) => {
      state.notifications = [];
    },

    // Update user activity timestamp
    updateUserActivity: (state) => {
      state.lastUserActivity = Date.now();
    },

    // Reset entire session (for logout or reset scenarios)
    resetSession: (state) => {
      const newSessionId = `session-${Date.now()}`;

      state.sessionId = newSessionId;
      state.history = [];
      state.isProcessing = false;
      state.lastProcessedMessageIndex = -1;
      state.errors = [];
      state.notifications = [];
      state.lastUserActivity = Date.now();
    }
  }
});

// Internal slice actions (work with plain objects)
const {
  addMessage: _addMessage,
  addMessages: _addMessages,
  removeMessage,
  updateMessage,
  clearHistory,
  setProcessing,
  setLastProcessedMessageIndex,
  addError,
  clearErrors,
  addNotification: _addNotification,
  clearNotifications,
  resetSession
} = chatSessionSlice.actions;

// Public action creators that handle serialization
export const addMessage = (message: ChatMessage) => {
  return _addMessage(messageToSerializable(message));
};

export const addMessages = (messages: ChatMessage[]) => {
  return _addMessages(messages.map(messageToSerializable));
};

export const addNotification = (notification: {
  type: "info" | "warning" | "error";
  message: string;
  timestamp: Date;
}) => {
  return _addNotification({
    ...notification,
    timestamp: notification.timestamp.toISOString()
  });
};

// Export other actions directly
export {
  removeMessage,
  updateMessage,
  clearHistory,
  setProcessing,
  setLastProcessedMessageIndex,
  addError,
  clearErrors,
  clearNotifications,
  resetSession
};

// Export internal actions that don't need serialization
export const { updateUserActivity } = chatSessionSlice.actions;

// Base selector for the raw session state
const selectChatSessionState = (state: { chatSession: ChatSessionState }) =>
  state.chatSession;

// Memoized selectors that convert back to ChatMessage class instances
export const selectChatSession = createSelector(
  [selectChatSessionState],
  (session): ChatSession => ({
    ...session,
    history: session.history.map(serializableToMessage),
    notifications: session.notifications.map((n) => ({
      ...n,
      timestamp: new Date(n.timestamp)
    }))
  })
);

export const selectChatHistory = createSelector(
  [(state: { chatSession: ChatSessionState }) => state.chatSession.history],
  (history): ChatMessage[] => history.map(serializableToMessage)
);

export const selectIsProcessing = (state: { chatSession: ChatSessionState }) =>
  state.chatSession.isProcessing;
export const selectLastProcessedMessageIndex = (state: {
  chatSession: ChatSessionState;
}) => state.chatSession.lastProcessedMessageIndex;
export const selectChatErrors = (state: { chatSession: ChatSessionState }) =>
  state.chatSession.errors;

// Memoized notifications selector
export const selectChatNotifications = createSelector(
  [
    (state: { chatSession: ChatSessionState }) =>
      state.chatSession.notifications
  ],
  (notifications) =>
    notifications.map((n) => ({
      ...n,
      timestamp: new Date(n.timestamp)
    }))
);

export default chatSessionSlice.reducer;
