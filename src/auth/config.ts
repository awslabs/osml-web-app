// Copyright Amazon.com, Inc. or its affiliates.
import { AuthOptions } from "next-auth";
import { JWT } from "next-auth/jwt";

// Extend the built-in session type
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: string;
  }
}

/**
 * Get the client ID lazily at runtime (not during build)
 * This allows the Next.js build to complete without the env var being set
 */
function getClientId(): string {
  const clientId = process.env.NEXTAUTH_CLIENT_ID;

  if (!clientId) {
    throw new Error(
      "Missing required environment variable: NEXTAUTH_CLIENT_ID"
    );
  }

  return clientId;
}

/**
 * Refreshes an access token using the refresh token
 */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const url = `${process.env.NEXT_PUBLIC_OIDC_AUTHORITY}/protocol/openid-connect/token`;
    const clientId = getClientId();

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
        resource: clientId
      }),
      method: "POST"
    });

    const refreshedTokens = (await response.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    if (!response.ok) {
      throw refreshedTokens;
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken // Fall back to old refresh token
    };
  } catch (error) {
    return {
      ...token,
      error: `RefreshAccessTokenError: ${error}`
    };
  }
}

export const authOptions: AuthOptions = {
  providers: [
    {
      id: "oidc",
      name: "OIDC Provider",
      type: "oauth",
      wellKnown: `${process.env.NEXT_PUBLIC_OIDC_AUTHORITY}/.well-known/openid-configuration`,
      clientId: process.env.NEXTAUTH_CLIENT_ID,
      authorization: {
        params: {
          scope: "openid profile email offline_access",
          resource: process.env.NEXTAUTH_CLIENT_ID
        }
      },
      idToken: true,
      checks: ["pkce", "state"],
      client: {
        token_endpoint_auth_method: "none" // public client
      },
      profile(profile) {
        const p = profile as unknown as Record<string, string>;
        return {
          id: p.sub,
          name: p.name,
          email: p.email
        };
      }
    }
  ],
  secret: process.env.NEXTAUTH_SECRET,
  debug: false,

  // Configure session strategy - use NextAuth defaults for proper token refresh
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60 // How long user stays logged in (30 days)
  },

  callbacks: {
    signIn() {
      return true;
    },
    async jwt({ token, account, user }) {
      // Initial sign in
      if (account && user) {
        // NextAuth's Account type has [key: string]: any — access through unknown to avoid unsafe-assignment
        const acct = account as unknown as Record<string, unknown>;
        return {
          accessToken: acct.access_token as string,
          accessTokenExpires: Date.now() + (acct.expires_in as number) * 1000,
          refreshToken: acct.refresh_token as string,
          user
        };
      }

      // Refresh token 15 seconds before expiration to prevent race conditions
      const REFRESH_BUFFER_MS = 15 * 1000;

      // Return previous token if it's not close to expiring
      if (
        Date.now() <
        (token.accessTokenExpires as number) - REFRESH_BUFFER_MS
      ) {
        return token;
      }

      // Access token is about to expire or has expired, refresh it
      return refreshAccessToken(token);
    },
    session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.error = token.error as string;

      // Pass through user information from token
      if (token.user) {
        session.user = token.user as typeof session.user;
      }

      return session;
    },
    redirect({ url, baseUrl }) {
      // Allows relative callback URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Allows callback URLs on the same origin
      if (url.startsWith(baseUrl)) return url;

      // For any other URLs, redirect to base URL for security
      return baseUrl;
    }
  }
};
