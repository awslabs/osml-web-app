// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for auth/config.ts.
 * Covers token refresh logic, JWT callback (initial sign-in, token reuse,
 * refresh trigger), session callback, redirect callback, and profile mapping.
 */

// Mock global fetch before importing the module
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Set required env vars before importing
process.env.OIDC_AUTHORITY = "https://auth.example.com";
process.env.NEXTAUTH_CLIENT_ID = "test-client-id";
process.env.NEXTAUTH_SECRET = "test-secret";

import { authOptions } from "@/auth/config";

// Extract callbacks for direct testing
const {
  jwt: jwtCallback,
  session: sessionCallback,
  redirect: redirectCallback
} = authOptions.callbacks!;

describe("auth/config", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // JWT callback — initial sign-in
  // -----------------------------------------------------------------------
  describe("jwt callback - initial sign-in", () => {
    it("should store tokens from account on first sign-in", async () => {
      const now = Date.now();
      const account = {
        access_token: "initial-access-token",
        expires_in: 3600,
        refresh_token: "initial-refresh-token"
      };
      const user = {
        id: "user-1",
        name: "Test User",
        email: "test@example.com"
      };

      const result = await jwtCallback!({
        token: {},
        account: account as never,
        user: user as never,
        trigger: "signIn"
      } as never);

      expect(result).toMatchObject({
        accessToken: "initial-access-token",
        refreshToken: "initial-refresh-token",
        user
      });
      // accessTokenExpires should be roughly now + 3600s
      expect(
        (result as Record<string, unknown>).accessTokenExpires
      ).toBeGreaterThan(now);
      expect(
        (result as Record<string, unknown>).accessTokenExpires
      ).toBeLessThanOrEqual(
        now + 3600 * 1000 + 1000 // small tolerance
      );
    });
  });

  // -----------------------------------------------------------------------
  // JWT callback — token still valid (no refresh needed)
  // -----------------------------------------------------------------------
  describe("jwt callback - token still valid", () => {
    it("should return existing token when not close to expiring", async () => {
      const token = {
        accessToken: "valid-token",
        accessTokenExpires: Date.now() + 60 * 1000, // expires in 60s (well beyond 15s buffer)
        refreshToken: "refresh-token"
      };

      const result = await jwtCallback!({
        token: token as never,
        account: null as never,
        user: undefined as never,
        trigger: "update"
      } as never);

      expect(result).toEqual(token);
    });
  });

  // -----------------------------------------------------------------------
  // JWT callback — token refresh triggered
  // -----------------------------------------------------------------------
  describe("jwt callback - token refresh", () => {
    it("should refresh token when within 15s of expiration", async () => {
      const token = {
        accessToken: "expiring-token",
        accessTokenExpires: Date.now() + 10 * 1000, // 10s left, within 15s buffer
        refreshToken: "old-refresh-token"
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-access-token",
            expires_in: 3600,
            refresh_token: "new-refresh-token"
          })
      });

      const result = await jwtCallback!({
        token: token as never,
        account: null as never,
        user: undefined as never,
        trigger: "update"
      } as never);

      expect((result as Record<string, unknown>).accessToken).toBe(
        "new-access-token"
      );
      expect((result as Record<string, unknown>).refreshToken).toBe(
        "new-refresh-token"
      );
    });

    it("should fall back to old refresh token when new one is not provided", async () => {
      const token = {
        accessToken: "expiring-token",
        accessTokenExpires: Date.now() - 1000, // already expired
        refreshToken: "old-refresh-token"
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-access-token",
            expires_in: 3600
            // no refresh_token in response
          })
      });

      const result = await jwtCallback!({
        token: token as never,
        account: null as never,
        user: undefined as never,
        trigger: "update"
      } as never);

      expect((result as Record<string, unknown>).refreshToken).toBe(
        "old-refresh-token"
      );
    });

    it("should set error on token when refresh fails", async () => {
      const token = {
        accessToken: "expiring-token",
        accessTokenExpires: Date.now() - 1000,
        refreshToken: "bad-refresh-token"
      };

      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "invalid_grant" })
      });

      const result = await jwtCallback!({
        token: token as never,
        account: null as never,
        user: undefined as never,
        trigger: "update"
      } as never);

      expect((result as Record<string, unknown>).error).toMatch(
        /RefreshAccessTokenError/
      );
    });

    it("surfaces an error on the token when the refresh token has been revoked", async () => {
      // OIDC servers return 400 with body { error: "invalid_grant" } when the
      // refresh token is revoked, expired, or otherwise invalid. The jwt
      // callback must populate the token's error field so NextAuth's session
      // handler picks it up and redirects the user to sign in. The redirect
      // itself is NextAuth library behavior and out of scope here.
      const token = {
        accessToken: "expiring-token",
        accessTokenExpires: Date.now() - 1000,
        refreshToken: "revoked-refresh-token"
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: "invalid_grant",
            error_description: "Refresh token revoked or expired"
          })
      });

      const result = await jwtCallback!({
        token: token as never,
        account: null as never,
        user: undefined as never,
        trigger: "update"
      } as never);

      const out = result as Record<string, unknown>;
      expect(out.error).toMatch(/RefreshAccessTokenError/);
      // Original token fields are preserved so NextAuth can still surface
      // them through the session callback for the redirect handler.
      expect(out.refreshToken).toBe("revoked-refresh-token");
    });

    it("should set error when fetch itself throws", async () => {
      const token = {
        accessToken: "expiring-token",
        accessTokenExpires: Date.now() - 1000,
        refreshToken: "refresh-token"
      };

      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await jwtCallback!({
        token: token as never,
        account: null as never,
        user: undefined as never,
        trigger: "update"
      } as never);

      expect((result as Record<string, unknown>).error).toMatch(
        /RefreshAccessTokenError/
      );
    });

    it("should call the correct token endpoint", async () => {
      const token = {
        accessToken: "expiring-token",
        accessTokenExpires: Date.now() - 1000,
        refreshToken: "refresh-token"
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-token",
            expires_in: 3600
          })
      });

      await jwtCallback!({
        token: token as never,
        account: null as never,
        user: undefined as never,
        trigger: "update"
      } as never);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://auth.example.com/protocol/openid-connect/token",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" }
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // Session callback
  // -----------------------------------------------------------------------
  describe("session callback", () => {
    it("should pass accessToken and error to session", () => {
      const session = { expires: "2099-01-01" } as never;
      const token = {
        accessToken: "session-token",
        error: "SomeError",
        user: { id: "u1", name: "User", email: "u@test.com" }
      };

      const result = sessionCallback!({
        session,
        token: token as never,
        trigger: "update",
        newSession: undefined
      } as never);

      expect((result as unknown as Record<string, unknown>).accessToken).toBe(
        "session-token"
      );
      expect((result as unknown as Record<string, unknown>).error).toBe(
        "SomeError"
      );
    });

    it("should pass user info from token to session", () => {
      const session = { expires: "2099-01-01" } as never;
      const user = { id: "u1", name: "User", email: "u@test.com" };
      const token = { accessToken: "tok", user };

      const result = sessionCallback!({
        session,
        token: token as never,
        trigger: "update",
        newSession: undefined
      } as never);

      expect((result as unknown as Record<string, unknown>).user).toEqual(user);
    });
  });

  // -----------------------------------------------------------------------
  // Redirect callback
  // -----------------------------------------------------------------------
  describe("redirect callback", () => {
    const baseUrl = "https://app.example.com";

    it("should allow relative URLs by prepending baseUrl", () => {
      const result = redirectCallback!({ url: "/dashboard", baseUrl } as never);
      expect(result).toBe("https://app.example.com/dashboard");
    });

    it("should allow URLs on the same origin", () => {
      const result = redirectCallback!({
        url: "https://app.example.com/settings",
        baseUrl
      } as never);
      expect(result).toBe("https://app.example.com/settings");
    });

    it("should redirect to baseUrl for external URLs", () => {
      const result = redirectCallback!({
        url: "https://evil.com/phish",
        baseUrl
      } as never);
      expect(result).toBe(baseUrl);
    });
  });

  // -----------------------------------------------------------------------
  // Provider profile mapping
  // -----------------------------------------------------------------------
  describe("provider profile mapping", () => {
    it("should extract id, name, email from OIDC profile", () => {
      const provider = authOptions.providers[0] as unknown as {
        profile: (p: Record<string, string>) => {
          id: string;
          name: string;
          email: string;
        };
      };

      const result = provider.profile({
        sub: "user-sub-123",
        name: "Jane Doe",
        email: "jane@example.com"
      });

      expect(result).toEqual({
        id: "user-sub-123",
        name: "Jane Doe",
        email: "jane@example.com"
      });
    });
  });

  // -----------------------------------------------------------------------
  // getClientId (tested indirectly via refresh)
  // -----------------------------------------------------------------------
  describe("getClientId", () => {
    it("should throw when NEXTAUTH_CLIENT_ID is not set", async () => {
      const originalClientId = process.env.NEXTAUTH_CLIENT_ID;
      delete process.env.NEXTAUTH_CLIENT_ID;

      const token = {
        accessToken: "expiring",
        accessTokenExpires: Date.now() - 1000,
        refreshToken: "refresh"
      };

      // refreshAccessToken calls getClientId internally
      const result = await jwtCallback!({
        token: token as never,
        account: null as never,
        user: undefined as never,
        trigger: "update"
      } as never);

      // Should have error because getClientId throws
      expect((result as Record<string, unknown>).error).toMatch(
        /RefreshAccessTokenError/
      );

      // Restore
      process.env.NEXTAUTH_CLIENT_ID = originalClientId;
    });
  });
});
