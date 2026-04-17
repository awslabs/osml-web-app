// Copyright Amazon.com, Inc. or its affiliates.
import { createSlice } from "@reduxjs/toolkit";

export interface ChatWidgetState {
  isOpen: boolean;
  isMinimized: boolean;
}

const initialState: ChatWidgetState = {
  isOpen: false,
  isMinimized: false
};

const chatWidgetSlice = createSlice({
  name: "chatWidget",
  initialState,
  reducers: {
    toggleWidget: (state) => {
      if (!state.isOpen) {
        // Open widget
        state.isOpen = true;
        state.isMinimized = false;
      } else if (state.isMinimized) {
        // Restore from minimized
        state.isMinimized = false;
      } else {
        // Minimize widget (keep open but minimized)
        state.isMinimized = true;
      }
    },

    openWidget: (state) => {
      state.isOpen = true;
      state.isMinimized = false;
    },

    closeWidget: (state) => {
      state.isOpen = false;
      state.isMinimized = false;
    },

    minimizeWidget: (state) => {
      state.isMinimized = true;
    },

    restoreWidget: (state) => {
      state.isMinimized = false;
    }
  }
});

export const {
  toggleWidget,
  openWidget,
  closeWidget,
  minimizeWidget,
  restoreWidget
} = chatWidgetSlice.actions;

export default chatWidgetSlice.reducer;

// Selectors
export const selectChatWidgetState = (state: { chatWidget: ChatWidgetState }) =>
  state.chatWidget;
export const selectIsWidgetOpen = (state: { chatWidget: ChatWidgetState }) =>
  state.chatWidget.isOpen;
export const selectIsWidgetMinimized = (state: {
  chatWidget: ChatWidgetState;
}) => state.chatWidget.isMinimized;
export const selectIsWidgetVisible = (state: { chatWidget: ChatWidgetState }) =>
  state.chatWidget.isOpen && !state.chatWidget.isMinimized;
