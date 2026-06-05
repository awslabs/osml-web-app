// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for chat-session-slice.ts.
 * Covers message serialization round-trips, session lifecycle,
 * notification handling, and selectors.
 */

import { configureStore } from "@reduxjs/toolkit";

import chatSessionReducer, {
  addError,
  addMessage,
  addMessages,
  addNotification,
  clearErrors,
  clearHistory,
  clearNotifications,
  removeMessage,
  resetSession,
  selectChatErrors,
  selectChatHistory,
  selectChatNotifications,
  selectIsProcessing,
  selectLastProcessedMessageIndex,
  serializableToMessage,
  setLastProcessedMessageIndex,
  setProcessing,
  updateMessage,
  updateUserActivity
} from "@/store/slices/chat-session-slice";
import { ChatMessage, MessageType } from "@/types/chat";

const createStore = () =>
  configureStore({ reducer: { chatSession: chatSessionReducer } });

function makeMessage(
  type: MessageType = MessageType.HUMAN,
  content = "Hello"
): ChatMessage {
  return new ChatMessage({ type, content });
}

describe("chat-session-slice", () => {
  // -----------------------------------------------------------------------
  // Serialization round-trip
  // -----------------------------------------------------------------------
  describe("serialization round-trip", () => {
    it("should preserve message fields through add → select cycle", () => {
      const store = createStore();
      const original = new ChatMessage({
        type: MessageType.AI,
        content: "Response text",
        toolCalls: [{ id: "tc-1", name: "get_viewport", args: { zoom: 5 } }],
        toolResults: [
          {
            toolCallId: "tc-1",
            toolName: "get_viewport",
            content: "{}",
            status: "success"
          }
        ],
        metadata: { custom: "data" },
        canRetry: true,
        error: "some error"
      });

      store.dispatch(addMessage(original));

      const history = selectChatHistory(store.getState());
      expect(history).toHaveLength(1);

      const restored = history[0];
      expect(restored.type).toBe(MessageType.AI);
      expect(restored.content).toBe("Response text");
      expect(restored.toolCalls).toHaveLength(1);
      expect(restored.toolCalls![0].name).toBe("get_viewport");
      expect(restored.toolResults).toHaveLength(1);
      expect(restored.metadata).toEqual({ custom: "data" });
      expect(restored.canRetry).toBe(true);
      expect(restored.error).toBe("some error");
      expect(restored.timestamp).toBeInstanceOf(Date);
    });

    it("serializableToMessage should restore id and timestamp", () => {
      const msg = serializableToMessage({
        id: "fixed-id",
        type: MessageType.HUMAN,
        content: "test",
        timestamp: "2025-06-15T12:00:00.000Z"
      });

      expect(msg.id).toBe("fixed-id");
      expect(msg.timestamp.toISOString()).toBe("2025-06-15T12:00:00.000Z");
      expect(msg).toBeInstanceOf(ChatMessage);
    });
  });

  // -----------------------------------------------------------------------
  // Message CRUD
  // -----------------------------------------------------------------------
  describe("message operations", () => {
    it("addMessages should add multiple messages at once", () => {
      const store = createStore();
      const msgs = [
        makeMessage(MessageType.HUMAN, "Hi"),
        makeMessage(MessageType.AI, "Hello")
      ];

      store.dispatch(addMessages(msgs));

      expect(selectChatHistory(store.getState())).toHaveLength(2);
    });

    it("removeMessage should remove by id", () => {
      const store = createStore();
      const msg = makeMessage();
      store.dispatch(addMessage(msg));

      const history = selectChatHistory(store.getState());
      store.dispatch(removeMessage(history[0].id));

      expect(selectChatHistory(store.getState())).toHaveLength(0);
    });

    it("updateMessage should update fields by id", () => {
      const store = createStore();
      const msg = makeMessage(MessageType.AI, "Original");
      store.dispatch(addMessage(msg));

      const id = selectChatHistory(store.getState())[0].id;
      store.dispatch(updateMessage({ id, updates: { content: "Updated" } }));

      expect(selectChatHistory(store.getState())[0].content).toBe("Updated");
    });

    it("updateMessage should be a no-op for non-existent id", () => {
      const store = createStore();
      store.dispatch(addMessage(makeMessage()));
      store.dispatch(
        updateMessage({ id: "nonexistent", updates: { content: "X" } })
      );

      expect(selectChatHistory(store.getState())[0].content).toBe("Hello");
    });

    it("clearHistory should remove all messages, errors, and notifications", () => {
      const store = createStore();
      store.dispatch(addMessage(makeMessage()));
      store.dispatch(addError("err"));
      store.dispatch(
        addNotification({
          type: "info",
          message: "note",
          timestamp: new Date()
        })
      );

      store.dispatch(clearHistory());

      expect(selectChatHistory(store.getState())).toHaveLength(0);
      expect(selectChatErrors(store.getState())).toHaveLength(0);
      expect(selectChatNotifications(store.getState())).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Processing state
  // -----------------------------------------------------------------------
  describe("processing state", () => {
    it("setProcessing should toggle isProcessing", () => {
      const store = createStore();
      store.dispatch(setProcessing(true));
      expect(selectIsProcessing(store.getState())).toBe(true);

      store.dispatch(setProcessing(false));
      expect(selectIsProcessing(store.getState())).toBe(false);
    });

    it("setLastProcessedMessageIndex should update index", () => {
      const store = createStore();
      store.dispatch(setLastProcessedMessageIndex(5));
      expect(selectLastProcessedMessageIndex(store.getState())).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // Errors
  // -----------------------------------------------------------------------
  describe("errors", () => {
    it("addError should accumulate errors", () => {
      const store = createStore();
      store.dispatch(addError("Error 1"));
      store.dispatch(addError("Error 2"));
      expect(selectChatErrors(store.getState())).toEqual([
        "Error 1",
        "Error 2"
      ]);
    });

    it("clearErrors should remove all errors", () => {
      const store = createStore();
      store.dispatch(addError("err"));
      store.dispatch(clearErrors());
      expect(selectChatErrors(store.getState())).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Notifications
  // -----------------------------------------------------------------------
  describe("notifications", () => {
    it("addNotification should serialize Date to ISO string and back", () => {
      const store = createStore();
      const ts = new Date("2025-03-15T10:00:00Z");
      store.dispatch(
        addNotification({
          type: "warning",
          message: "Watch out",
          timestamp: ts
        })
      );

      const notifications = selectChatNotifications(store.getState());
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe("warning");
      expect(notifications[0].message).toBe("Watch out");
      expect(notifications[0].timestamp).toBeInstanceOf(Date);
      expect(notifications[0].timestamp.toISOString()).toBe(
        "2025-03-15T10:00:00.000Z"
      );
    });

    it("clearNotifications should remove all notifications", () => {
      const store = createStore();
      store.dispatch(
        addNotification({
          type: "info",
          message: "note",
          timestamp: new Date()
        })
      );
      store.dispatch(clearNotifications());
      expect(selectChatNotifications(store.getState())).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------
  describe("session lifecycle", () => {
    it("resetSession should create new session ID and clear everything", () => {
      const store = createStore();
      const originalId = store.getState().chatSession.sessionId;

      store.dispatch(addMessage(makeMessage()));
      store.dispatch(addError("err"));
      store.dispatch(setProcessing(true));

      store.dispatch(resetSession());

      const session = store.getState().chatSession;
      expect(session.sessionId).not.toBe(originalId);
      expect(session.history).toHaveLength(0);
      expect(session.errors).toHaveLength(0);
      expect(session.isProcessing).toBe(false);
      expect(session.lastProcessedMessageIndex).toBe(-1);
    });

    it("updateUserActivity should update the timestamp", () => {
      const store = createStore();
      const before = Date.now();
      store.dispatch(updateUserActivity());
      expect(
        store.getState().chatSession.lastUserActivity
      ).toBeGreaterThanOrEqual(before);
    });
  });
});
