// Copyright Amazon.com, Inc. or its affiliates.
import { getSession } from "next-auth/react";

/**
 * Error thrown by AuthenticatedApiClient when the server returns a non-OK response.
 * Preserves the HTTP status, parsed response body, and original Response object.
 */
export interface ApiError extends Error {
  status: number;
  data: Record<string, unknown> | null;
  response: Response;
}

/** Type-guard for ApiError */
export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof (error as ApiError).status === "number"
  );
}

/**
 * Authenticated API client that automatically includes JWT tokens from NextAuth session
 */
export class AuthenticatedApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make an authenticated request with automatic token injection
   */
  async request<T = unknown>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Get the current session
    const session = await getSession();

    if (!session?.accessToken) {
      throw new Error("No authentication token available. Please sign in.");
    }

    // Prepare headers with authentication
    const headers = new Headers(options.headers);

    headers.set("Authorization", `Bearer ${session.accessToken}`);
    headers.set("Content-Type", "application/json");

    // Normalize URL construction to avoid double slashes
    // Remove trailing slash from baseUrl and ensure endpoint starts with slash
    const normalizedBase = this.baseUrl.replace(/\/+$/, "");
    const normalizedEndpoint = endpoint.startsWith("/")
      ? endpoint
      : `/${endpoint}`;
    const url = `${normalizedBase}${normalizedEndpoint}`;

    // Make the request
    const response = await fetch(url, {
      ...options,
      headers
    });

    // Handle authentication errors
    if (response.status === 401) {
      throw new Error("Authentication failed. Please sign in again.");
    }

    // Handle non-OK responses by preserving response data
    if (!response.ok) {
      const responseText = await response.text();
      let errorData: Record<string, unknown> | null = null;

      try {
        errorData = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        // If response isn't JSON, use raw text
        errorData = { message: responseText };
      }

      // Create enhanced error object that preserves response details
      const enhancedError = new Error(
        `HTTP error! status: ${response.status}`
      ) as Error & {
        status: number;
        data: typeof errorData;
        response: Response;
      };

      enhancedError.status = response.status;
      enhancedError.data = errorData;
      enhancedError.response = response;

      throw enhancedError;
    }

    // Handle response parsing with base64 fallback
    const responseText = await response.text();

    // Handle 204 No Content - return empty object
    if (response.status === 204 || !responseText) {
      return {} as T;
    }

    try {
      // Try parsing as JSON first (most common case)
      return JSON.parse(responseText) as T;
    } catch (jsonError) {
      try {
        // If JSON parsing fails, try base64 decoding then parsing
        const decodedText = atob(responseText);

        return JSON.parse(decodedText) as T;
      } catch (base64Error) {
        // If both fail, throw error with details
        const jsonMsg =
          jsonError instanceof Error ? jsonError.message : "Unknown JSON error";
        const b64Msg =
          base64Error instanceof Error
            ? base64Error.message
            : "Unknown base64 error";

        throw new Error(
          `Failed to parse response as JSON (${jsonMsg}) or base64 (${b64Msg})`
        );
      }
    }
  }

  /**
   * GET request helper
   */
  async get<T = unknown>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  /**
   * POST request helper
   */
  async post<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined
    });
  }

  /**
   * PUT request helper
   */
  async put<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined
    });
  }

  /**
   * DELETE request helper
   */
  async delete<T = unknown>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }
}

// Create singleton instances for each API
export const utilityApiClient = new AuthenticatedApiClient(
  process.env.NEXT_PUBLIC_UTILITY_API_URL || ""
);

export const modelRunnerApiClient = new AuthenticatedApiClient(
  process.env.NEXT_PUBLIC_MODEL_RUNNER_API_URL || ""
);

export const tileServerApiClient = new AuthenticatedApiClient(
  process.env.NEXT_PUBLIC_TILE_SERVER_URL || ""
);

export const dataCatalogApiClient = new AuthenticatedApiClient(
  process.env.NEXT_PUBLIC_STAC_CATALOG_URL || ""
);
