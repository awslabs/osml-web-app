// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for AuthenticatedApiClient.
 * Covers JWT injection, URL normalization, response parsing (JSON, 204),
 * error handling (401, non-OK, malformed JSON), and the isApiError type guard.
 */

import { AuthenticatedApiClient, isApiError } from "@/utils/api-client";

// Mock next-auth/react
jest.mock("next-auth/react", () => ({
  getSession: jest.fn()
}));

// Import after mock setup
import { getSession } from "next-auth/react";

const mockGetSession = getSession as jest.MockedFunction<typeof getSession>;

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("AuthenticatedApiClient", () => {
  let client: AuthenticatedApiClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new AuthenticatedApiClient("https://api.example.com");
    mockGetSession.mockResolvedValue({
      accessToken: "test-jwt-token",
      expires: "2099-01-01T00:00:00.000Z"
    } as ReturnType<typeof getSession> extends Promise<infer T> ? T : never);
  });

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------
  describe("authentication", () => {
    it("should inject Authorization header with Bearer token", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ data: "ok" }))
      });

      await client.get("/test");

      const [, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = fetchOptions.headers as Headers;
      expect(headers.get("Authorization")).toBe("Bearer test-jwt-token");
    });

    it("should set Content-Type to application/json", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({}))
      });

      await client.get("/test");

      const [, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = fetchOptions.headers as Headers;
      expect(headers.get("Content-Type")).toBe("application/json");
    });

    it("should throw when no session is available", async () => {
      mockGetSession.mockResolvedValue(null);
      await expect(client.get("/test")).rejects.toThrow(
        "No authentication token available"
      );
    });

    it("should throw when session has no accessToken", async () => {
      mockGetSession.mockResolvedValue({
        expires: "2099-01-01"
      } as ReturnType<typeof getSession> extends Promise<infer T> ? T : never);
      await expect(client.get("/test")).rejects.toThrow(
        "No authentication token available"
      );
    });
  });

  // -----------------------------------------------------------------------
  // URL normalization
  // -----------------------------------------------------------------------
  describe("URL normalization", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({}))
      });
    });

    it("should construct URL from base + endpoint", async () => {
      await client.get("/items");
      expect(mockFetch.mock.calls[0][0]).toBe("https://api.example.com/items");
    });

    it("should strip trailing slashes from base URL", async () => {
      const trailingClient = new AuthenticatedApiClient(
        "https://api.example.com/"
      );
      await trailingClient.get("/items");
      expect(mockFetch.mock.calls[0][0]).toBe("https://api.example.com/items");
    });

    it("should add leading slash to endpoint if missing", async () => {
      await client.get("items");
      expect(mockFetch.mock.calls[0][0]).toBe("https://api.example.com/items");
    });

    it("should handle both trailing base slash and missing endpoint slash", async () => {
      const trailingClient = new AuthenticatedApiClient(
        "https://api.example.com///"
      );
      await trailingClient.get("items");
      expect(mockFetch.mock.calls[0][0]).toBe("https://api.example.com/items");
    });
  });

  // -----------------------------------------------------------------------
  // Response parsing
  // -----------------------------------------------------------------------
  describe("response parsing", () => {
    it("should parse JSON response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ result: 42 }))
      });

      const data = await client.get<{ result: number }>("/test");
      expect(data).toEqual({ result: 42 });
    });

    it("should return empty object for 204 No Content", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve("")
      });

      const data = await client.delete("/resource/1");
      expect(data).toEqual({});
    });

    it("should return empty object for empty response body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("")
      });

      const data = await client.get("/empty");
      expect(data).toEqual({});
    });

    it("rejects base64-encoded JSON instead of silently decoding it", async () => {
      // The previous client transparently decoded base64 of valid JSON; that
      // confused-deputy fallback was removed. A backend that returns
      // base64-encoded text should now surface as a parse error, not be
      // misinterpreted as structured data.
      const payload = { decoded: true };
      const base64 = btoa(JSON.stringify(payload));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(base64)
      });

      await expect(client.get("/b64")).rejects.toThrow(
        /Failed to parse response as JSON/
      );
    });

    it("rejects HTML error pages instead of misinterpreting them as data", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            "<!DOCTYPE html><html><body>Server error</body></html>"
          )
      });

      await expect(client.get("/html")).rejects.toThrow(
        /Failed to parse response as JSON/
      );
    });

    it("throws a descriptive error when JSON parsing fails", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("<<<not json>>>")
      });

      await expect(client.get("/bad")).rejects.toThrow(
        /Failed to parse response as JSON/
      );
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------
  describe("error handling", () => {
    it("should throw specific message for 401 responses", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("")
      });

      await expect(client.get("/protected")).rejects.toThrow(
        "Authentication failed. Please sign in again."
      );
    });

    it("should throw enhanced error with status and JSON data for non-OK responses", async () => {
      const errorBody = { error: "Not Found", detail: "Resource missing" };
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve(JSON.stringify(errorBody))
      });

      try {
        await client.get("/missing");
        throw new Error("should not reach here");
      } catch (err: unknown) {
        const error = err as Error & {
          status: number;
          data: Record<string, unknown>;
        };
        expect(error.message).toContain("404");
        expect(error.status).toBe(404);
        expect(error.data).toEqual(errorBody);
      }
    });

    it("should wrap non-JSON error body in { message: text }", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error")
      });

      try {
        await client.get("/error");
        throw new Error("should not reach here");
      } catch (err: unknown) {
        const error = err as Error & {
          status: number;
          data: Record<string, unknown>;
        };
        expect(error.status).toBe(500);
        expect(error.data).toEqual({ message: "Internal Server Error" });
      }
    });
  });

  // -----------------------------------------------------------------------
  // HTTP method helpers
  // -----------------------------------------------------------------------
  describe("HTTP method helpers", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ ok: true }))
      });
    });

    it("GET should use GET method", async () => {
      await client.get("/resource");
      expect(mockFetch.mock.calls[0][1].method).toBe("GET");
    });

    it("POST should use POST method and serialize body", async () => {
      await client.post("/resource", { name: "test" });
      const opts = mockFetch.mock.calls[0][1] as RequestInit;
      expect(opts.method).toBe("POST");
      expect(opts.body).toBe(JSON.stringify({ name: "test" }));
    });

    it("POST without body should not include body", async () => {
      await client.post("/resource");
      expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
    });

    it("PUT should use PUT method and serialize body", async () => {
      await client.put("/resource", { updated: true });
      const opts = mockFetch.mock.calls[0][1] as RequestInit;
      expect(opts.method).toBe("PUT");
      expect(opts.body).toBe(JSON.stringify({ updated: true }));
    });

    it("DELETE should use DELETE method", async () => {
      await client.delete("/resource/1");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });
  });
});

// ---------------------------------------------------------------------------
// isApiError type guard
// ---------------------------------------------------------------------------
describe("isApiError", () => {
  it("should return true for error with numeric status property", () => {
    const error = new Error("test") as Error & { status: number };
    error.status = 404;
    expect(isApiError(error)).toBe(true);
  });

  it("should return false for plain Error without status", () => {
    expect(isApiError(new Error("test"))).toBe(false);
  });

  it("should return false for non-Error objects", () => {
    expect(isApiError({ status: 404, message: "not found" })).toBe(false);
  });

  it("should return false for null/undefined", () => {
    expect(isApiError(null)).toBe(false);
    expect(isApiError(undefined)).toBe(false);
  });

  it("should return false for string", () => {
    expect(isApiError("error")).toBe(false);
  });
});
