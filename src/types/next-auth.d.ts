// Copyright Amazon.com, Inc. or its affiliates.
import "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: string;
    user?: {
      id?: string;
      name?: string;
      email?: string;
    };
  }
}
