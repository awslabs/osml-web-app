// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { CSSProperties, ReactNode } from "react";

// Set Cesium base URL before importing Cesium modules
// This tells Cesium where to find its static assets (Workers, Assets, Widgets, ThirdParty)
if (typeof window !== "undefined") {
  (window as typeof window & { CESIUM_BASE_URL: string }).CESIUM_BASE_URL =
    "cesium";
}

import "cesium/Build/Cesium/Widgets/widgets.css";

import clsx from "clsx";
import { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { Provider } from "react-redux";

import { Providers } from "@/app/providers";
import { AppInitializer } from "@/components/app-initializer";
import { Navbar } from "@/components/navbar";
import { RouteTracker } from "@/components/navigation/route-tracker";
import { fontSans } from "@/config/fonts";
import { store } from "@/store/store";

const styles = {
  "--navbar-height": "4rem"
} as CSSProperties;

export function RootLayoutClient({
  children,
  session
}: {
  children: ReactNode;
  session: Session | null;
}) {
  return (
    <html suppressHydrationWarning lang="en">
      <head />
      <body
        suppressHydrationWarning
        className={clsx(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable
        )}
        style={styles}
      >
        <SessionProvider session={session}>
          <Provider store={store}>
            <Providers
              themeProps={{ attribute: "class", defaultTheme: "dark" }}
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
          </Provider>
        </SessionProvider>
      </body>
    </html>
  );
}
