// Copyright Amazon.com, Inc. or its affiliates.
import "@/styles/globals.css";

import clsx from "clsx";
import { Metadata, Viewport } from "next";
import { getServerSession } from "next-auth";
import { CSSProperties, ReactNode } from "react";

import { RootLayoutClient } from "@/app/layout-client";
import { authOptions } from "@/auth/config";
import { fontSans } from "@/config/fonts";
import { readRuntimeConfigFromEnv } from "@/config/runtime-config";
import { siteConfig } from "@/config/site";
import { safeStringifyForScript } from "@/utils/safe-stringify";

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s - ${siteConfig.name}`
  },
  description: siteConfig.description,
  icons: {
    icon: "/images/oversightml-favicon-color.ico"
  }
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" }
  ]
};

const bodyStyle = {
  "--navbar-height": "4rem"
} as CSSProperties;

export default async function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  let session = null;

  if (process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_CLIENT_ID) {
    session = await getServerSession(authOptions);
  }

  // Inject runtime config into the SSR'd HTML head as
  // `window.__OSML_CONFIG__` so module-load reads in `siteConfig` see a
  // populated value before any client bundle runs.
  const runtimeConfig = readRuntimeConfigFromEnv();
  const runtimeConfigScript = `window.__OSML_CONFIG__=${safeStringifyForScript(runtimeConfig)}`;

  return (
    <html suppressHydrationWarning lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: runtimeConfigScript }} />
      </head>
      <body
        suppressHydrationWarning
        className={clsx(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable
        )}
        style={bodyStyle}
      >
        <RootLayoutClient session={session}>{children}</RootLayoutClient>
      </body>
    </html>
  );
}
