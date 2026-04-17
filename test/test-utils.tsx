// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Shared test utilities for React Testing Library tests.
 * Provides a Redux-wrapped renderHook/render for hooks and components
 * that depend on the Redux store.
 */

import { configureStore } from "@reduxjs/toolkit";
import { render, renderHook, RenderOptions } from "@testing-library/react";
import React, { ReactElement } from "react";
import { Provider } from "react-redux";

import analyticsReducer from "@/store/slices/analytics-slice";
import bedrockModelReducer from "@/store/slices/bedrock-model-slice";
import bedrockQuotaReducer from "@/store/slices/bedrock-quota-slice";
import bedrockThrottleReducer from "@/store/slices/bedrock-throttle-slice";
import chatSessionReducer from "@/store/slices/chat-session-slice";
import chatWidgetReducer from "@/store/slices/chat-widget-slice";
import dataCatalogReducer from "@/store/slices/data-catalog-slice";
import imageViewerReducer from "@/store/slices/image-viewer-slice";
import imageryReducer from "@/store/slices/imagery-slice";
import jobsReducer from "@/store/slices/jobs-slice";
import mcpReducer from "@/store/slices/mcp-slice";
import navbarReducer from "@/store/slices/navbar-slice";
import overlayReducer from "@/store/slices/overlay-slice";
import s3Reducer from "@/store/slices/s3-slice";
import sagemakerEndpointReducer from "@/store/slices/sagemaker-endpoint-slice";
import settingsReducer from "@/store/slices/settings-slice";
import viewportReducer from "@/store/slices/viewport-slice";

const testReducers = {
  analytics: analyticsReducer,
  navbar: navbarReducer,
  imageViewer: imageViewerReducer,
  s3: s3Reducer,
  jobs: jobsReducer,
  imagery: imageryReducer,
  mcp: mcpReducer,
  bedrockModel: bedrockModelReducer,
  bedrockThrottle: bedrockThrottleReducer,
  bedrockQuota: bedrockQuotaReducer,
  chatWidget: chatWidgetReducer,
  chatSession: chatSessionReducer,
  viewport: viewportReducer,
  overlay: overlayReducer,
  settings: settingsReducer,
  dataCatalog: dataCatalogReducer,
  sagemakerEndpoint: sagemakerEndpointReducer
};

/**
 * Create a fresh test store with all reducers.
 */
export function createTestStore() {
  return configureStore({
    reducer: testReducers
  });
}

export type TestStore = ReturnType<typeof createTestStore>;

/**
 * Wrapper component that provides a Redux store to children.
 */
function createWrapper(store: TestStore) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

/**
 * Render a hook with a Redux Provider wrapper.
 * Returns the renderHook result plus the store for assertions.
 */
export function renderHookWithStore<TResult>(
  hook: () => TResult,
  options?: { store?: TestStore }
) {
  const store = options?.store ?? createTestStore();
  const wrapper = createWrapper(store);

  const result = renderHook(hook, { wrapper });

  return { ...result, store };
}

/**
 * Render a component with a Redux Provider wrapper.
 * Returns the render result plus the store for assertions.
 */
export function renderWithStore(
  ui: ReactElement,
  options?: {
    store?: TestStore;
  } & Omit<RenderOptions, "wrapper">
) {
  const store = options?.store ?? createTestStore();
  const wrapper = createWrapper(store);

  const result = render(ui, { ...options, wrapper });

  return { ...result, store };
}
