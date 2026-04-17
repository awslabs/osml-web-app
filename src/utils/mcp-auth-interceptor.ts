// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Fetch interceptor that adds authentication headers to MCP server requests
 * This allows use-mcp library to work with authenticated endpoints transparently
 */

let originalFetch: typeof fetch;
let mcpServerUrls: Set<string> = new Set();

/**
 * Initialize MCP authentication interceptor
 */
export function initMcpAuthInterceptor(serverUrls: string[]) {
  // Store MCP server URLs for targeted interception
  mcpServerUrls = new Set(serverUrls.map((url) => new URL(url).origin));

  // Only patch fetch once
  if (!originalFetch) {
    originalFetch = window.fetch;

    // Patch global fetch to intercept MCP requests
    window.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : "";

      // Only intercept absolute URLs that match MCP servers
      let urlOrigin: string;
      let isMcpRequest = false;

      try {
        const urlObj = new URL(url);

        urlOrigin = urlObj.origin;
        isMcpRequest = mcpServerUrls.has(urlOrigin);

        // Additional safety check: Don't intercept AWS API Gateway tile server requests
        if (
          urlObj.hostname.includes("execute-api") &&
          urlObj.pathname.includes("/tiles/")
        ) {
          isMcpRequest = false;
        }
      } catch {
        // URL parsing failed (likely relative URL) - don't intercept
        return originalFetch(input, init);
      }

      if (isMcpRequest) {
        try {
          // Try to get session from Next.js API endpoint directly
          const sessionResponse = await originalFetch("/api/auth/session");

          if (sessionResponse.ok) {
            const session = (await sessionResponse.json()) as {
              accessToken?: string;
            };

            if (session?.accessToken) {
              // Preserve original headers and only add Authorization
              const existingHeaders = new Headers(init?.headers);

              existingHeaders.set(
                "Authorization",
                `Bearer ${session.accessToken}`
              );

              const authenticatedInit = {
                ...init,
                headers: existingHeaders
              };

              // Make request with authentication
              return originalFetch(input, authenticatedInit);
            }
          }
        } catch {
          // Silently handle auth errors - requests will proceed without auth
        }
      }

      // For non-MCP requests or if auth failed, use original fetch
      return originalFetch(input, init);
    };
  }
}

/**
 * Update MCP server URLs for the interceptor
 */
export function updateMcpServerUrls(serverUrls: string[]) {
  mcpServerUrls = new Set(serverUrls.map((url) => new URL(url).origin));
}

/**
 * Clean up fetch interceptor (restore original fetch)
 */
export function cleanupMcpAuthInterceptor() {
  if (originalFetch) {
    window.fetch = originalFetch;
    mcpServerUrls.clear();
  }
}
