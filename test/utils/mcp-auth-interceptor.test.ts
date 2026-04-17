// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for mcp-auth-interceptor.ts.
 * Covers init, URL matching, token injection, cleanup, and updateMcpServerUrls.
 *
 * Note: jsdom doesn't have Response, so we use plain objects as mock responses.
 */

// Save original fetch before any module loads
const originalWindowFetch = global.fetch;

// Type for the mcp-auth-interceptor module
interface McpAuthInterceptorModule {
  initMcpAuthInterceptor: (serverUrls: string[]) => void;
  cleanupMcpAuthInterceptor: () => void;
  updateMcpServerUrls: (serverUrls: string[]) => void;
}

// Helper to create a mock response (jsdom has no Response class)
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

beforeEach(() => {
  jest.resetModules();
  // Restore original fetch
  global.fetch = originalWindowFetch;
  if (typeof window !== "undefined") {
    window.fetch = originalWindowFetch;
  }
});

describe("mcp-auth-interceptor", () => {
  it("initMcpAuthInterceptor should patch window.fetch", () => {
    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;
    const before = window.fetch;

    initMcpAuthInterceptor(["https://mcp.example.com/sse"]);

    expect(window.fetch).not.toBe(before);
  });

  it("cleanupMcpAuthInterceptor should restore original fetch", () => {
    // Set a known fetch function first
    const knownFetch = jest.fn();
    window.fetch = knownFetch;

    const { initMcpAuthInterceptor, cleanupMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;

    initMcpAuthInterceptor(["https://mcp.example.com/sse"]);
    // fetch is now patched (different from knownFetch)
    expect(window.fetch).not.toBe(knownFetch);

    cleanupMcpAuthInterceptor();
    // After cleanup, fetch should be restored to knownFetch
    expect(window.fetch).toBe(knownFetch);
  });

  it("should pass through non-MCP requests without modification", async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse("ok"));
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;
    initMcpAuthInterceptor(["https://mcp.example.com/sse"]);

    await window.fetch("https://other-api.com/data");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://other-api.com/data");
  });

  it("should pass through relative URLs without interception", async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse("ok"));
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;
    initMcpAuthInterceptor(["https://mcp.example.com/sse"]);

    await window.fetch("/api/local");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should inject auth header for MCP server requests", async () => {
    const mockFetch = jest.fn().mockImplementation((input: string) => {
      if (typeof input === "string" && input === "/api/auth/session") {
        return Promise.resolve(
          mockResponse(JSON.stringify({ accessToken: "jwt-token-123" }), {
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      return Promise.resolve(mockResponse("mcp response"));
    });
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;
    initMcpAuthInterceptor(["https://mcp.example.com/sse"]);

    await window.fetch("https://mcp.example.com/messages");

    // Should have called fetch for session + the actual request
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // The actual MCP request should have Authorization header
    const mcpCall = mockFetch.mock.calls[1] as [string, RequestInit];
    const headers = mcpCall[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer jwt-token-123");
  });

  it("should not intercept tile server requests even if origin matches", async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockResponse("tile data"));
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;
    initMcpAuthInterceptor([
      "https://api.execute-api.us-east-1.amazonaws.com/mcp"
    ]);

    await window.fetch(
      "https://api.execute-api.us-east-1.amazonaws.com/tiles/0/0/0.png"
    );

    // Should pass through without session fetch
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("updateMcpServerUrls should update the URL set", async () => {
    const mockFetch = jest.fn().mockImplementation((input: string) => {
      if (typeof input === "string" && input === "/api/auth/session") {
        return Promise.resolve(
          mockResponse(JSON.stringify({ accessToken: "tok" }))
        );
      }
      return Promise.resolve(mockResponse("ok"));
    });
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor, updateMcpServerUrls } =
      require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;

    initMcpAuthInterceptor(["https://old-server.com/mcp"]);
    updateMcpServerUrls(["https://new-server.com/mcp"]);

    // Request to old server should NOT be intercepted
    await window.fetch("https://old-server.com/messages");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockClear();

    // Request to new server SHOULD be intercepted
    await window.fetch("https://new-server.com/messages");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should gracefully handle session fetch failure", async () => {
    const mockFetch = jest.fn().mockImplementation((input: string) => {
      if (typeof input === "string" && input === "/api/auth/session") {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve(mockResponse("fallback"));
    });
    window.fetch = mockFetch;

    const { initMcpAuthInterceptor } =
      require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;
    initMcpAuthInterceptor(["https://mcp.example.com/sse"]);

    // Should not throw — falls back to unauthenticated request
    const response = await window.fetch("https://mcp.example.com/messages");
    expect(response).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: interceptor conditional paths (lines 17-30, 38-39, 61-82)
// ---------------------------------------------------------------------------

describe("mcp-auth-interceptor - branch coverage", () => {
  const origFetch = global.fetch;

  afterEach(() => {
    const { cleanupMcpAuthInterceptor: cleanup } =
      require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;
    cleanup();
    global.fetch = origFetch;
    if (typeof window !== "undefined") window.fetch = origFetch;
  });

  it("should add auth header to MCP server requests", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accessToken: "test-token" })
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    global.fetch = mockFetch;
    window.fetch = mockFetch;

    jest.isolateModules(() => {
      const { initMcpAuthInterceptor } =
        require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;
      initMcpAuthInterceptor(["https://mcp.example.com/sse"]);
    });

    await window.fetch("https://mcp.example.com/sse/messages", {
      method: "POST"
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should skip non-MCP requests", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;
    window.fetch = mockFetch;

    jest.isolateModules(() => {
      const { initMcpAuthInterceptor } =
        require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;
      initMcpAuthInterceptor(["https://mcp.example.com/sse"]);
    });

    await window.fetch("https://other-api.com/data");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should handle session fetch failure gracefully", async () => {
    const mockFetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ ok: true });
    global.fetch = mockFetch;
    window.fetch = mockFetch;

    jest.isolateModules(() => {
      const { initMcpAuthInterceptor } =
        require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;
      initMcpAuthInterceptor(["https://mcp.example.com/sse"]);
    });

    const response = await window.fetch("https://mcp.example.com/sse/messages");
    expect(response).toBeDefined();
  });

  it("should skip AWS API Gateway tile requests", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;
    window.fetch = mockFetch;

    jest.isolateModules(() => {
      const { initMcpAuthInterceptor } =
        require("@/utils/mcp-auth-interceptor") as McpAuthInterceptorModule;
      initMcpAuthInterceptor([
        "https://abc123.execute-api.us-east-1.amazonaws.com"
      ]);
    });

    await window.fetch(
      "https://abc123.execute-api.us-east-1.amazonaws.com/tiles/1/2/3.png"
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
