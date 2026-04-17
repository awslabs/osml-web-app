// Copyright Amazon.com, Inc. or its affiliates.
import "@/styles/globals.css";

import { Metadata, Viewport } from "next";
import { getServerSession } from "next-auth";
import { ReactNode } from "react";

import { RootLayoutClient } from "@/app/layout-client";
import { authOptions } from "@/auth/config";
import { siteConfig } from "@/config/site";

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

export default async function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  let session = null;

  // Only attempt to get session if auth is properly configured
  if (process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_CLIENT_ID) {
    session = await getServerSession(authOptions);
  }

  return <RootLayoutClient session={session}>{children}</RootLayoutClient>;
}
