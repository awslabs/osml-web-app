// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for mcp-auth-interceptor.ts. Covers init, three auth modes, allowlist
 * re-validation, tile-server carve-out, cleanup, and updateMcpServerUrls.
 *
 * jsdom doesn't have Response, so plain objects are used as mock responses.
 */

import type { McpServerConfig } from "@/hooks/use-mcp";

const originalWindowFetch = global.fetch;

interface InterceptorModule {
  initMcpAuthInterceptor: (servers: McpServerConfig[]) => void;
  cleanupMcpAuthInterceptor: () => void;
  updateMcpServerUrls: (servers: McpServerConfig[]) => void;
}

function mockResponse(
  body: string,
  opts: { status?: number; headers?: Record<string, string> } = {}
) {
  return {
    ok: (opts.status ?? 200) >= 200 && (opts.status ?? 200) < 300,
    status: opts.status ?? 200,
    headers: new Headers(opts.headers),
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
    blob: () => Promise.resolve(new Blob([body]))
  };
}

function makeServer(
  overrides: Partial<McpServerConfig> & { url: string }
): McpServerConfig {
  return {
    id: overrides.id ?? "srv",
    name: overrides.name ?? "Server",
    enabled: overrides.enabled ?? true,
    connectionStatus: overrides.connectionStatus ?? "active",
    autoApprovedTools: overrides.autoApprovedTools ?? [],
    disabledTools: overrides.disabledTools ?? [],
    authMode: overrides.authMode ?? "session",
    ...overrides
  };
}

beforeEach(() => {
  jest.resetModules();
  localStorage.clear();
  global.fetch = originalWindowFetch;
  if (typeof window !== "undefined") {
    window.fetch = originalWindowFetch;
  }
});

describe("mcp-auth-interceptor - init/cleanup", () => {
  it("patches window.fetch on init", () => {
    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    const before = window.fetch;
    initMcpAuthInterceptor([
      makeServer({ url: "https://mcp.amazonaws.com/sse" })
    ]);
    expect(window.fetch).not.toBe(before);
  });

  it("restores fetch on cleanup", () => {
    const known = jest.fn();
    window.fetch = known;
    const { initMcpAuthInterceptor, cleanupMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([
      makeServer({ url: "https://mcp.amazonaws.com/sse" })
    ]);
    cleanupMcpAuthInterceptor();
    expect(window.fetch).toBe(known);
  });
});

describe("mcp-auth-interceptor - request matching", () => {
  it("passes through non-MCP requests unchanged", async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse("ok"));
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([
      makeServer({ url: "https://mcp.amazonaws.com/sse" })
    ]);

    await window.fetch("https://other-api.com/data");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("passes through relative URLs unchanged", async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse("ok"));
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([
      makeServer({ url: "https://mcp.amazonaws.com/sse" })
    ]);

    await window.fetch("/api/local");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("skips tile-server requests on a registered API Gateway origin", async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse("tile data"));
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([
      makeServer({
        url: "https://api.execute-api.us-east-1.amazonaws.com/mcp"
      })
    ]);

    await window.fetch(
      "https://api.execute-api.us-east-1.amazonaws.com/tiles/0/0/0.png"
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("skips servers using the local:// pseudo-scheme", async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse("ok"));
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([makeServer({ url: "local://viewport" })]);

    await window.fetch("https://other.example.com/foo");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("mcp-auth-interceptor - auth modes", () => {
  it("authMode 'none': pass through with no Authorization header", async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse("ok"));
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([
      makeServer({
        url: "https://geo.amazonaws.com/mcp",
        authMode: "none"
      })
    ]);

    await window.fetch("https://geo.amazonaws.com/mcp/messages");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // No /api/auth/session call, no Authorization header
    const init = mockFetch.mock.calls[0][1] as RequestInit | undefined;
    const headers = init?.headers as Headers | undefined;
    expect(headers?.get("Authorization") ?? null).toBeNull();
  });

  it("authMode 'session': fetches session and attaches bearer token", async () => {
    const mockFetch = jest.fn().mockImplementation((input: string) => {
      if (input === "/api/auth/session") {
        return Promise.resolve(
          mockResponse(JSON.stringify({ accessToken: "session-jwt" }))
        );
      }
      return Promise.resolve(mockResponse("mcp ok"));
    });
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([
      makeServer({
        url: "https://geo.amazonaws.com/mcp",
        authMode: "session"
      })
    ]);

    await window.fetch("https://geo.amazonaws.com/mcp/messages");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const headers = mockFetch.mock.calls[1][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer session-jwt");
  });

  it("authMode 'custom': reads token from mcp-token-store", async () => {
    const { setToken } =
      require("@/services/mcp-token-store") as typeof import("@/services/mcp-token-store");
    setToken("custom-srv", "stored-secret");

    const mockFetch = jest.fn().mockResolvedValue(mockResponse("ok"));
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([
      makeServer({
        id: "custom-srv",
        url: "https://geo.amazonaws.com/mcp",
        authMode: "custom"
      })
    ]);

    await window.fetch("https://geo.amazonaws.com/mcp/messages");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const headers = mockFetch.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer stored-secret");
  });

  it("authMode 'custom' with missing token: passes through unauthenticated", async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse("ok"));
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([
      makeServer({
        id: "no-token-srv",
        url: "https://geo.amazonaws.com/mcp",
        authMode: "custom"
      })
    ]);

    await window.fetch("https://geo.amazonaws.com/mcp/messages");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0][1] as RequestInit | undefined;
    const headers = init?.headers as Headers | undefined;
    expect(headers?.get("Authorization") ?? null).toBeNull();
  });

  it("authMode 'session' with session fetch failure: passes through unauthenticated", async () => {
    const mockFetch = jest.fn().mockImplementation((input: string) => {
      if (input === "/api/auth/session") {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve(mockResponse("ok"));
    });
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([
      makeServer({
        url: "https://geo.amazonaws.com/mcp",
        authMode: "session"
      })
    ]);

    const res = await window.fetch("https://geo.amazonaws.com/mcp/messages");
    expect(res).toBeDefined();
    // Session attempt + actual request, but no auth header
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("overwrites caller-supplied Authorization header", async () => {
    const mockFetch = jest.fn().mockImplementation((input: string) => {
      if (input === "/api/auth/session") {
        return Promise.resolve(
          mockResponse(JSON.stringify({ accessToken: "real-token" }))
        );
      }
      return Promise.resolve(mockResponse("ok"));
    });
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([
      makeServer({
        url: "https://geo.amazonaws.com/mcp",
        authMode: "session"
      })
    ]);

    await window.fetch("https://geo.amazonaws.com/mcp/messages", {
      headers: { Authorization: "Bearer attacker-token" }
    });
    const headers = mockFetch.mock.calls[1][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer real-token");
  });
});

describe("mcp-auth-interceptor - allowlist defense in depth", () => {
  it("refuses to attach auth when registered host fails the allowlist", async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse("ok"));
    window.fetch = mockFetch;

    // Server registers under a host outside the default allowlist. The map is
    // populated, but the fetch hook re-validates and refuses to attach auth.
    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;
    initMcpAuthInterceptor([
      makeServer({
        url: "https://evil.example.com/mcp",
        authMode: "session"
      })
    ]);

    await window.fetch("https://evil.example.com/mcp/messages");
    // No /api/auth/session call, no Authorization header — pass through only.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0][1] as RequestInit | undefined;
    expect(
      (init?.headers as Headers | undefined)?.get("Authorization") ?? null
    ).toBeNull();
  });
});

describe("mcp-auth-interceptor - updateMcpServerUrls", () => {
  it("replaces the registered set", async () => {
    const mockFetch = jest.fn().mockImplementation((input: string) => {
      if (input === "/api/auth/session") {
        return Promise.resolve(
          mockResponse(JSON.stringify({ accessToken: "tok" }))
        );
      }
      return Promise.resolve(mockResponse("ok"));
    });
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor, updateMcpServerUrls } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;

    initMcpAuthInterceptor([
      makeServer({
        url: "https://old.amazonaws.com/mcp",
        authMode: "session"
      })
    ]);
    updateMcpServerUrls([
      makeServer({
        url: "https://new.amazonaws.com/mcp",
        authMode: "session"
      })
    ]);

    // Old host no longer registered — pass-through only.
    await window.fetch("https://old.amazonaws.com/mcp/messages");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockClear();

    // New host is registered — session fetch + actual request.
    await window.fetch("https://new.amazonaws.com/mcp/messages");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("stops attaching auth to a previously-registered origin after it is removed", async () => {
    const mockFetch = jest.fn().mockImplementation((input: string) => {
      if (input === "/api/auth/session") {
        return Promise.resolve(
          mockResponse(JSON.stringify({ accessToken: "tok" }))
        );
      }
      return Promise.resolve(mockResponse("ok"));
    });
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor, updateMcpServerUrls } =
      require("@/utils/mcp-auth-interceptor") as InterceptorModule;

    initMcpAuthInterceptor([
      makeServer({
        url: "https://geo.amazonaws.com/mcp",
        authMode: "session"
      })
    ]);

    // First call: server registered, session fetch + actual request, header attached.
    await window.fetch("https://geo.amazonaws.com/mcp/messages");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstHeaders = mockFetch.mock.calls[1][1].headers as Headers;
    expect(firstHeaders.get("Authorization")).toBe("Bearer tok");

    mockFetch.mockClear();

    // User removes the server: registered set becomes empty.
    updateMcpServerUrls([]);

    // Second call to the same origin must not get auth and must not fetch session.
    await window.fetch("https://geo.amazonaws.com/mcp/messages");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0][1] as RequestInit | undefined;
    expect(
      (init?.headers as Headers | undefined)?.get("Authorization") ?? null
    ).toBeNull();
  });
});
