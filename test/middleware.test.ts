// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for middleware.ts.
 * Covers the exported config matcher pattern.
 */

// Mock next-auth/middleware since it's server-only
jest.mock("next-auth/middleware", () => ({
  __esModule: true,
  default: jest.fn(),
  withAuth: jest.fn((fn: () => void, opts: Record<string, unknown>) => ({
    fn,
    opts
  }))
}));

import { config } from "@/middleware";

describe("middleware", () => {
  it("should export a config with matcher patterns", () => {
    expect(config).toBeDefined();
    expect(config.matcher).toBeDefined();
    expect(Array.isArray(config.matcher)).toBe(true);
  });

  it("matcher should exclude api/auth, _next, and favicon", () => {
    const pattern = config.matcher[0];
    // The pattern is a negative lookahead regex string
    expect(pattern).toContain("api/auth");
    expect(pattern).toContain("_next");
    expect(pattern).toContain("favicon");
  });

  it("matcher pattern excludes NextAuth and asset paths but matches user routes", () => {
    // Convert Next's matcher to a real regex and verify the negative-lookahead
    // actually rejects the paths it claims to. This guards against accidental
    // weakening of the exclusion list.
    const pattern = new RegExp(`^${config.matcher[0]}$`);

    expect(pattern.test("/")).toBe(true);
    expect(pattern.test("/dashboard")).toBe(true);
    expect(pattern.test("/api/jobs")).toBe(true);

    expect(pattern.test("/api/auth")).toBe(false);
    expect(pattern.test("/api/auth/signin")).toBe(false);
    expect(pattern.test("/api/auth/callback/oidc")).toBe(false);
    expect(pattern.test("/_next/static/foo.js")).toBe(false);
    expect(pattern.test("/favicon.ico")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cover the withAuth callback and middleware function (line 10)
// ---------------------------------------------------------------------------

import { withAuth } from "next-auth/middleware";

describe("middleware - withAuth integration", () => {
  it("should call withAuth with a middleware function and callbacks", () => {
    // Import the default export to trigger the withAuth call
    require("@/middleware");

    expect(withAuth).toHaveBeenCalledWith(
      expect.any(Function) as unknown,
      expect.objectContaining({
        callbacks: expect.objectContaining({
          authorized: expect.any(Function) as unknown
        }) as unknown
      }) as unknown
    );
  });

  it("authorized callback should return true when token exists", () => {
    const call = (withAuth as jest.Mock).mock.calls[0] as [
      () => void,
      { callbacks: { authorized: (params: { token: unknown }) => boolean } }
    ];
    const authorizedFn = call[1].callbacks.authorized;

    expect(authorizedFn({ token: { sub: "user-1" } })).toBe(true);
  });

  it("authorized callback should return false when token is null", () => {
    const call = (withAuth as jest.Mock).mock.calls[0] as [
      () => void,
      { callbacks: { authorized: (params: { token: unknown }) => boolean } }
    ];
    const authorizedFn = call[1].callbacks.authorized;

    expect(authorizedFn({ token: null })).toBe(false);
  });

  it("authorized callback rejects undefined and falsy token shapes", () => {
    // NextAuth surfaces an absent or expired session as a null/undefined
    // token after its own decoding step. Tampered tokens that fail signature
    // verification arrive the same way. Both must fall through to false.
    const call = (withAuth as jest.Mock).mock.calls[0] as [
      () => void,
      { callbacks: { authorized: (params: { token: unknown }) => boolean } }
    ];
    const authorizedFn = call[1].callbacks.authorized;

    expect(authorizedFn({ token: undefined })).toBe(false);
    expect(authorizedFn({ token: "" })).toBe(false);
    expect(authorizedFn({ token: 0 })).toBe(false);
    expect(authorizedFn({ token: false })).toBe(false);
  });

  it("middleware function should be callable", () => {
    const call = (withAuth as jest.Mock).mock.calls[0] as [() => void, unknown];
    const middlewareFn = call[0];

    // Should not throw
    expect(() => middlewareFn()).not.toThrow();
  });
});
