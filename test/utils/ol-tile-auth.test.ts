// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ol-tile-auth.ts.
 * Covers fetchSessionToken, fetchTileWithAuth, retryTileLoad,
 * and createAuthenticatedTileLoader.
 */

// Mock ol/ImageTile and ol/Tile types (type-only imports, no runtime needed)
jest.mock("ol/ImageTile", () => ({}));
jest.mock("ol/Tile", () => ({}));

import {
  createAuthenticatedTileLoader,
  fetchSessionToken,
  fetchTileWithAuth,
  retryTileLoad
} from "@/utils/ol-tile-auth";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock XMLHttpRequest
const mockXhr = {
  open: jest.fn(),
  setRequestHeader: jest.fn(),
  send: jest.fn(),
  onload: null as (() => void) | null,
  onerror: null as (() => void) | null,
  status: 200,
  response: new Blob(["tile-data"]),
  responseType: ""
};

const MockXMLHttpRequest = jest.fn(() => mockXhr);
global.XMLHttpRequest = MockXMLHttpRequest as unknown as typeof XMLHttpRequest;

beforeEach(() => {
  jest.clearAllMocks();
  mockXhr.status = 200;
  mockXhr.response = new Blob(["tile-data"]);
  mockXhr.onload = null;
  mockXhr.onerror = null;
});

describe("fetchSessionToken", () => {
  it("should return access token from session endpoint", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accessToken: "test-token" })
    });

    const token = await fetchSessionToken();
    expect(token).toBe("test-token");
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/session");
  });

  it("should return empty string when session has no token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    });

    const token = await fetchSessionToken();
    expect(token).toBe("");
  });

  it("should return empty string when fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const token = await fetchSessionToken();
    expect(token).toBe("");
  });

  it("should return empty string when response is not ok", async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const token = await fetchSessionToken();
    expect(token).toBe("");
  });
});

describe("fetchTileWithAuth", () => {
  it("should make XHR request with auth header", async () => {
    const promise = fetchTileWithAuth(
      "https://tiles.example.com/0/0/0.png",
      "my-token"
    );

    // Simulate successful response
    mockXhr.onload!();

    const blob = await promise;
    expect(blob).toBeInstanceOf(Blob);
    expect(mockXhr.open).toHaveBeenCalledWith(
      "GET",
      "https://tiles.example.com/0/0/0.png"
    );
    expect(mockXhr.setRequestHeader).toHaveBeenCalledWith(
      "Authorization",
      "Bearer my-token"
    );
    expect(mockXhr.responseType).toBe("blob");
  });

  it("should not set auth header when token is empty", async () => {
    const promise = fetchTileWithAuth(
      "https://tiles.example.com/0/0/0.png",
      ""
    );

    mockXhr.onload!();

    await promise;
    expect(mockXhr.setRequestHeader).not.toHaveBeenCalled();
  });

  it("should reject on non-200 status", async () => {
    mockXhr.status = 404;
    const promise = fetchTileWithAuth(
      "https://tiles.example.com/0/0/0.png",
      "token"
    );

    mockXhr.onload!();

    await expect(promise).rejects.toThrow("HTTP 404");
  });

  it("should reject on network error", async () => {
    const promise = fetchTileWithAuth(
      "https://tiles.example.com/0/0/0.png",
      "token"
    );

    mockXhr.onerror!();

    await expect(promise).rejects.toThrow("Network error");
  });
});

describe("retryTileLoad", () => {
  it("should return result on first success", async () => {
    const loadFn = jest.fn().mockResolvedValue("success");

    const result = await retryTileLoad(loadFn, 3, 10);
    expect(result).toBe("success");
    expect(loadFn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure and succeed", async () => {
    const loadFn = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("success");

    const result = await retryTileLoad(loadFn, 3, 10);
    expect(result).toBe("success");
    expect(loadFn).toHaveBeenCalledTimes(2);
  });

  it("should return undefined after max retries", async () => {
    const loadFn = jest.fn().mockRejectedValue(new Error("always fails"));

    const result = await retryTileLoad(loadFn, 3, 10);
    expect(result).toBeUndefined();
    expect(loadFn).toHaveBeenCalledTimes(3);
  });

  it("should use default retry parameters", async () => {
    const loadFn = jest.fn().mockResolvedValue("ok");

    const result = await retryTileLoad(loadFn);
    expect(result).toBe("ok");
  });
});

describe("createAuthenticatedTileLoader", () => {
  it("should return a function", () => {
    const loader = createAuthenticatedTileLoader();
    expect(typeof loader).toBe("function");
  });

  it("should accept custom retry parameters", () => {
    const loader = createAuthenticatedTileLoader(5, 1000);
    expect(typeof loader).toBe("function");
  });

  it("should call fetchSessionToken and fetchTileWithAuth when invoked", async () => {
    // Mock fetch for session token
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accessToken: "tile-token" })
    });

    const loader = createAuthenticatedTileLoader(1, 10);

    // Create a mock tile object
    const mockTile = {
      getImage: () => ({ src: "", addEventListener: jest.fn() }),
      getState: () => 1,
      addEventListener: jest.fn()
    };

    // Start the loader — it will call fetchSessionToken then fetchTileWithAuth
    const loadPromise = loader(
      mockTile as never,
      "https://tiles.example.com/0/0/0.png"
    );

    // The XHR onload needs to fire for fetchTileWithAuth to resolve
    // Wait a tick for the async chain to reach the XHR
    await new Promise((r) => setTimeout(r, 50));

    if (mockXhr.onload) {
      mockXhr.onload();
    }

    await loadPromise;

    // Session token should have been fetched
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/session");
    // XHR should have been opened with the tile URL
    expect(mockXhr.open).toHaveBeenCalledWith(
      "GET",
      "https://tiles.example.com/0/0/0.png"
    );
    // Auth header should have been set
    expect(mockXhr.setRequestHeader).toHaveBeenCalledWith(
      "Authorization",
      "Bearer tile-token"
    );
  });
});
