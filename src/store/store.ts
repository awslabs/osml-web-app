// Copyright Amazon.com, Inc. or its affiliates.
import { configureStore } from "@reduxjs/toolkit";

import dataCatalogReducer from "@/store/slices/data-catalog-slice.ts";
import imageViewerReducer from "@/store/slices/image-viewer-slice.ts";
import navbarReducer from "@/store/slices/navbar-slice.ts";
import s3Reducer from "@/store/slices/s3-slice.ts";
import sagemakerEndpointReducer from "@/store/slices/sagemaker-endpoint-slice.ts";

import analyticsReducer from "./slices/analytics-slice.ts";
import bedrockModelReducer from "./slices/bedrock-model-slice.ts";
import bedrockQuotaReducer from "./slices/bedrock-quota-slice.ts";
import bedrockThrottleReducer from "./slices/bedrock-throttle-slice.ts";
import chatSessionReducer from "./slices/chat-session-slice.ts";
import chatWidgetReducer from "./slices/chat-widget-slice.ts";
import imageryReducer from "./slices/imagery-slice.ts";
import jobsReducer, { fetchDataMiddleware } from "./slices/jobs-slice.ts";
import mcpReducer from "./slices/mcp-slice.ts";
import overlayReducer from "./slices/overlay-slice.ts";
import settingsReducer from "./slices/settings-slice.ts";
import viewportReducer from "./slices/viewport-slice.ts";

export const store = configureStore({
  reducer: {
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
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(fetchDataMiddleware),
  devTools: process.env.NODE_ENV !== "production"
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export default store;
