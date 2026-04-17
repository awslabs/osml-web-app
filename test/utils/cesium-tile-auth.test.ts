// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for cesium-tile-auth.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

// Mock the cesium module so we don't need the full Cesium runtime in jsdom
jest.mock("cesium", () => {
  class MockResource {
    url: string;
    headers: Record<string, string>;
    retryAttempts?: number;
    retryCallback?: (...args: unknown[]) => unknown;

    constructor(options: {
      url: string;
      headers?: Record<string, string>;
      retryAttempts?: number;
      retryCallback?: (...args: unknown[]) => unknown;
    }) {
      this.url = options.url;
      this.headers = options.headers ?? {};
      this.retryAttempts = options.retryAttempts;
      this.retryCallback = options.retryCallback;
    }
  }

  return { Resource: MockResource };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockFetchSuccess(token: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ accessToken: token })
  });
}

function mockFetchFailure() {
  global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));
}

function mockFetchNon200() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: () => Promise.resolve({})
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("cesium-tile-auth", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /**
   * Validates: Requirement 2.1
   * fetchBearerToken fetches from /api/auth/session and returns the accessToken.
   */
  describe("fetchBearerToken", () => {
    it("returns token from successful session response", async () => {
      mockFetchSuccess("my-bearer-token");

      // Use isolateModules to get a fresh module (resets cached token)
      let fetchBearerToken: () => Promise<string>;
      jest.isolateModules(() => {
        ({ fetchBearerToken } =
          require("@/utils/cesium-tile-auth") as typeof import("@/utils/cesium-tile-auth"));
      });

      const token = await fetchBearerToken!();

      expect(global.fetch).toHaveBeenCalledWith("/api/auth/session");
      expect(token).toBe("my-bearer-token");
    });

    /**
     * Validates: Requirement 2.3
     * Returns empty string when fetch fails (graceful degradation).
     */
    it("returns empty string on fetch failure", async () => {
      mockFetchFailure();

      let fetchBearerToken: () => Promise<string>;
      jest.isolateModules(() => {
        ({ fetchBearerToken } =
          require("@/utils/cesium-tile-auth") as typeof import("@/utils/cesium-tile-auth"));
      });

      const token = await fetchBearerToken!();

      expect(token).toBe("");
    });

    /**
     * Validates: Requirement 2.3
     * Returns empty string when response is not ok (non-200).
     */
    it("returns empty string on non-200 response", async () => {
      mockFetchNon200();

      let fetchBearerToken: () => Promise<string>;
      jest.isolateModules(() => {
        ({ fetchBearerToken } =
          require("@/utils/cesium-tile-auth") as typeof import("@/utils/cesium-tile-auth"));
      });

      const token = await fetchBearerToken!();

      expect(token).toBe("");
    });

    /**
     * Validates: Requirement 2.2
     * Cached token is returned within TOKEN_CACHE_DURATION (60s).
     */
    it("returns cached token within cache duration", async () => {
      jest.useFakeTimers();
      mockFetchSuccess("cached-token");

      let fetchBearerToken: () => Promise<string>;
      let TOKEN_CACHE_DURATION: number;
      jest.isolateModules(() => {
        ({ fetchBearerToken, TOKEN_CACHE_DURATION } =
          require("@/utils/cesium-tile-auth") as typeof import("@/utils/cesium-tile-auth"));
      });

      // First call — fetches from endpoint
      const token1 = await fetchBearerToken!();
      expect(token1).toBe("cached-token");
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Advance time by less than cache duration
      jest.advanceTimersByTime(TOKEN_CACHE_DURATION! - 1000);

      // Second call — should return cached token without fetching again
      const token2 = await fetchBearerToken!();
      expect(token2).toBe("cached-token");
      expect(global.fetch).toHaveBeenCalledTimes(1); // Still only 1 fetch
    });

    /**
     * Validates: Requirement 2.2
     * Token is re-fetched after cache expiry.
     */
    it("re-fetches after cache expiry", async () => {
      jest.useFakeTimers();
      mockFetchSuccess("first-token");

      let fetchBearerToken: () => Promise<string>;
      let TOKEN_CACHE_DURATION: number;
      jest.isolateModules(() => {
        ({ fetchBearerToken, TOKEN_CACHE_DURATION } =
          require("@/utils/cesium-tile-auth") as typeof import("@/utils/cesium-tile-auth"));
      });

      // First call — fetches from endpoint
      const token1 = await fetchBearerToken!();
      expect(token1).toBe("first-token");

      // Advance time past cache duration
      jest.advanceTimersByTime(TOKEN_CACHE_DURATION! + 1);

      // Update mock to return a different token
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ accessToken: "refreshed-token" })
      });

      // Second call — should re-fetch
      const token2 = await fetchBearerToken!();
      expect(token2).toBe("refreshed-token");
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * Validates: Requirement 2.4
   * createAuthenticatedResource returns a Cesium Resource with the correct URL.
   */
  describe("createAuthenticatedResource", () => {
    it("returns Resource with correct URL", () => {
      let createAuthenticatedResource: (baseUrl: string) => { url: string };
      jest.isolateModules(() => {
        ({ createAuthenticatedResource } =
          require("@/utils/cesium-tile-auth") as typeof import("@/utils/cesium-tile-auth"));
      });

      const baseUrl =
        "https://tiles.example.com/viewpoints/{viewpointId}/tiles/{z}/{y}/{x}.PNG";
      const resource = createAuthenticatedResource!(baseUrl);

      expect(resource).toBeDefined();
      expect(resource.url).toBe(baseUrl);
    });
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for createAuthenticatedResource retryCallback (lines 50-61)
// ---------------------------------------------------------------------------

describe("createAuthenticatedResource - retryCallback", () => {
  it("should set retryAttempts to 1", () => {
    let createAuthenticatedResource: (baseUrl: string) => {
      retryAttempts?: number;
    };
    jest.isolateModules(() => {
      ({ createAuthenticatedResource } =
        require("@/utils/cesium-tile-auth") as typeof import("@/utils/cesium-tile-auth"));
    });

    const resource = createAuthenticatedResource!("https://tiles.example.com");
    expect(resource.retryAttempts).toBe(1);
  });

  it("retryCallback should refresh token on 401 and return true", async () => {
    mockFetchSuccess("new-token");

    let createAuthenticatedResource: (baseUrl: string) => {
      retryCallback?: (
        resource?: { headers: Record<string, string> },
        error?: { statusCode?: number }
      ) => Promise<boolean>;
      headers: Record<string, string>;
    };
    jest.isolateModules(() => {
      ({ createAuthenticatedResource } =
        require("@/utils/cesium-tile-auth") as typeof import("@/utils/cesium-tile-auth"));
    });

    const resource = createAuthenticatedResource!("https://tiles.example.com");
    const result = await resource.retryCallback!(resource, { statusCode: 401 });
    expect(result).toBe(true);
    expect(resource.headers["Authorization"]).toBe("Bearer new-token");
  });

  it("retryCallback should refresh token on 403", async () => {
    mockFetchSuccess("refreshed-token");

    let createAuthenticatedResource: (baseUrl: string) => {
      retryCallback?: (
        resource?: { headers: Record<string, string> },
        error?: { statusCode?: number }
      ) => Promise<boolean>;
      headers: Record<string, string>;
    };
    jest.isolateModules(() => {
      ({ createAuthenticatedResource } =
        require("@/utils/cesium-tile-auth") as typeof import("@/utils/cesium-tile-auth"));
    });

    const resource = createAuthenticatedResource!("https://tiles.example.com");
    const result = await resource.retryCallback!(resource, { statusCode: 403 });
    expect(result).toBe(true);
  });

  it("retryCallback should return false for non-auth errors", async () => {
    let createAuthenticatedResource: (baseUrl: string) => {
      retryCallback?: (
        resource?: unknown,
        error?: { statusCode?: number }
      ) => Promise<boolean>;
    };
    jest.isolateModules(() => {
      ({ createAuthenticatedResource } =
        require("@/utils/cesium-tile-auth") as typeof import("@/utils/cesium-tile-auth"));
    });

    const resource = createAuthenticatedResource!("https://tiles.example.com");
    const result = await resource.retryCallback!(resource, { statusCode: 500 });
    expect(result).toBe(false);
  });

  it("retryCallback should return false when token refresh fails on 401", async () => {
    mockFetchFailure();

    let createAuthenticatedResource: (baseUrl: string) => {
      retryCallback?: (
        resource?: { headers: Record<string, string> },
        error?: { statusCode?: number }
      ) => Promise<boolean>;
      headers: Record<string, string>;
    };
    jest.isolateModules(() => {
      ({ createAuthenticatedResource } =
        require("@/utils/cesium-tile-auth") as typeof import("@/utils/cesium-tile-auth"));
    });

    const resource = createAuthenticatedResource!("https://tiles.example.com");
    const result = await resource.retryCallback!(resource, { statusCode: 401 });
    expect(result).toBe(false);
  });
});
