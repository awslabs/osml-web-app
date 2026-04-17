// Copyright Amazon.com, Inc. or its affiliates.
import { Resource } from "cesium";

/**
 * Duration (in ms) for which a fetched Bearer token is cached before re-fetching.
 */
export const TOKEN_CACHE_DURATION = 60_000; // 1 minute

// Module-level cache variables
let cachedToken: string = "";
let tokenFetchedAt: number = 0;

/**
 * Fetches the current Bearer token from the auth session endpoint.
 * Caches the token for TOKEN_CACHE_DURATION (60s).
 * Returns empty string if auth fails (tiles load without auth header).
 */
export async function fetchBearerToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now - tokenFetchedAt < TOKEN_CACHE_DURATION) {
    return cachedToken;
  }

  try {
    const response = await fetch("/api/auth/session");
    if (response.ok) {
      const session = (await response.json()) as { accessToken?: string };
      if (session?.accessToken) {
        cachedToken = session.accessToken;
        tokenFetchedAt = now;
        return cachedToken;
      }
    }
  } catch {
    // Auth fetch failed — proceed without token
  }
  return "";
}

/**
 * Creates a Cesium Resource configured with Bearer token authentication.
 * Sets retryAttempts: 1 and a retryCallback that clears the cached token
 * on 401/403, fetches a fresh one, and retries once.
 */
export function createAuthenticatedResource(baseUrl: string): Resource {
  const resource = new Resource({
    url: baseUrl,
    retryAttempts: 1,
    retryCallback: async (
      resource?: Resource,
      error?: { statusCode?: number }
    ) => {
      if (error?.statusCode === 401 || error?.statusCode === 403) {
        // Force refresh token
        cachedToken = "";
        const token = await fetchBearerToken();
        if (token && resource) {
          resource.headers["Authorization"] = `Bearer ${token}`;
          return true; // Retry the request
        }
      }
      return false; // Don't retry
    }
  });

  return resource;
}
