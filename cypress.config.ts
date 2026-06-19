// Copyright Amazon.com, Inc. or its affiliates.
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "cypress";
import { encode } from "next-auth/jwt";

// Cypress's Node process does not load .env.local the way `next dev` does.
// Load it here (same loader Next uses) so the mintSessionToken task can read
// NEXTAUTH_SECRET.
loadEnvConfig(process.cwd());

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    supportFile: "cypress/support/e2e.ts",
    specPattern: "cypress/e2e/**/*.cy.{js,jsx,ts,tsx}",
    screenshotOnRunFailure: true,
    video: true,
    videoCompression: 32,
    viewportWidth: 1280,
    viewportHeight: 720,
    // No automatic retries: specs mock all backend reads and wait on DOM/store
    // state rather than bare network aliases, so every failure signals a real
    // defect rather than flake to be masked.
    retries: { runMode: 0, openMode: 0 },
    defaultCommandTimeout: 10000,
    requestTimeout: 10000,
    // Generous response/page-load timeouts so the first authenticated visit can
    // absorb the dev-server cold compile of the heavy map/globe routes
    // (OpenLayers + Cesium chunks).
    responseTimeout: 120000,
    pageLoadTimeout: 120000,
    setupNodeEvents(on) {
      // Mint a valid NextAuth (v4) JWT session cookie in Node, where the
      // NEXTAUTH_SECRET and the next-auth/jwt encode() helper are available.
      // The encrypted token is handed back to the browser via cy.loginBypass(),
      // which sets it as the `next-auth.session-token` cookie so the auth
      // middleware (authorized: !!token) lets protected routes load.
      on("task", {
        async mintSessionToken(overrides: Record<string, unknown> = {}) {
          const secret = process.env.NEXTAUTH_SECRET;
          if (!secret) {
            throw new Error(
              "NEXTAUTH_SECRET is not set — required to mint a test session token"
            );
          }

          const oneHour = 60 * 60;
          const token = {
            accessToken: "cypress-test-access-token",
            accessTokenExpires: Date.now() + oneHour * 1000,
            refreshToken: "cypress-test-refresh-token",
            user: {
              name: "Cypress Test User",
              email: "cypress@example.com"
            },
            ...overrides
          };

          return encode({ token, secret, maxAge: 30 * 24 * oneHour });
        }
      });
    }
  },
  component: {
    devServer: {
      framework: "next",
      bundler: "webpack"
    }
  }
});
