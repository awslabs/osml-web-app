// Copyright Amazon.com, Inc. or its affiliates.
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import {
  FLUSH,
  PAUSE,
  PERSIST,
  persistReducer,
  persistStore,
  PURGE,
  REGISTER,
  REHYDRATE
} from "redux-persist";
import createWebStorage from "redux-persist/lib/storage/createWebStorage";

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
import imageryReducer from "./slices/imagery-slice.ts";
import jobsReducer, { fetchDataMiddleware } from "./slices/jobs-slice.ts";
import mcpReducer from "./slices/mcp-slice.ts";
import overlayReducer from "./slices/overlay-slice.ts";
import settingsReducer from "./slices/settings-slice.ts";
import viewportReducer from "./slices/viewport-slice.ts";

// Server-side: localStorage is not available, so redux-persist's getItem
// resolves to null and setItem is a no-op. The client uses real localStorage.
const createNoopStorage = () => ({
  getItem: () => Promise.resolve<string | null>(null),
  setItem: (_key: string, value: string) => Promise.resolve(value),
  removeItem: () => Promise.resolve()
});
const storage =
  typeof window !== "undefined"
    ? createWebStorage("local")
    : createNoopStorage();

const rootReducer = combineReducers({
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
  chatSession: chatSessionReducer,
  viewport: viewportReducer,
  overlay: overlayReducer,
  settings: settingsReducer,
  dataCatalog: dataCatalogReducer,
  sagemakerEndpoint: sagemakerEndpointReducer
});

const persistedReducer = persistReducer(
  {
    key: "osml-root",
    version: 1,
    storage,
    whitelist: ["settings"]
  },
  rootReducer
);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]
      }
    }).concat(fetchDataMiddleware),
  devTools: process.env.NODE_ENV !== "production"
});

export const persistor = persistStore(store);

// Test-only: expose the store on window so Cypress e2e specs can read state and
// dispatch actions. Gated out of production builds so it is never shipped.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __OSML_STORE__: typeof store }).__OSML_STORE__ =
    store;
}

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
export default store;
