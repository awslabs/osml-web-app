// Copyright Amazon.com, Inc. or its affiliates.
import type { OsmlRuntimeConfig } from "@/config/runtime-config";

declare global {
  interface Window {
    __OSML_CONFIG__?: OsmlRuntimeConfig;
  }
}

export {};
