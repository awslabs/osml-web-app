// Copyright Amazon.com, Inc. or its affiliates.
// Custom Cypress commands

/**
 * Authenticate the session so protected routes load without a real OIDC login.
 *
 * Two layers are needed because NextAuth checks auth in two places:
 *  1. The Next.js middleware reads the encrypted `next-auth.session-token`
 *     cookie server-side (authorized: !!token). We mint a real one via the
 *     `mintSessionToken` Node task and set it as a cookie.
 *  2. Client components call `useSession()` which hits `/api/auth/session`.
 *     We stub that endpoint so the client also sees an authenticated session.
 */
Cypress.Commands.add("loginBypass", () => {
  cy.task<string>("mintSessionToken").then((sessionToken) => {
    cy.setCookie("next-auth.session-token", sessionToken);
  });

  cy.intercept("GET", "**/api/auth/session", {
    statusCode: 200,
    body: {
      user: { name: "Cypress Test User", email: "cypress@example.com" },
      accessToken: "cypress-test-access-token",
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }
  }).as("getSession");
});

declare global {
  namespace Cypress {
    interface Chainable {
      loginBypass(): Chainable<void>;
    }
  }
}

export {};
