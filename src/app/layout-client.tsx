// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { ReactNode } from "react";

// Set Cesium base URL before importing Cesium modules
// This tells Cesium where to find its static assets (Workers, Assets, Widgets, ThirdParty)
if (typeof window !== "undefined") {
  (window as typeof window & { CESIUM_BASE_URL: string }).CESIUM_BASE_URL =
    "cesium";
}

import "cesium/Build/Cesium/Widgets/widgets.css";

import { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";

import { Providers } from "@/app/providers";
import { AppInitializer } from "@/components/app-initializer";
import { Navbar } from "@/components/navbar";
import { RouteTracker } from "@/components/navigation/route-tracker";
import { persistor, store } from "@/store/store";

export function RootLayoutClient({
  children,
  session
}: {
  children: ReactNode;
  session: Session | null;
}) {
  return (
    <SessionProvider session={session}>
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <Providers
            themeProps={{ attribute: "class", defaultTheme: "system" }}
          >
            <AppInitializer />
            <RouteTracker />
            <div className="flex flex-col h-screen">
              <Navbar />
              <main className="flex-grow w-full h-[calc(100vh-var(--navbar-height))]">
                {children}
              </main>
            </div>
          </Providers>
        </PersistGate>
      </Provider>
    </SessionProvider>
  );
}
