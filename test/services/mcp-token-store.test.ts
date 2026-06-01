// Copyright Amazon.com, Inc. or its affiliates.
import {
  __getAllTokensForTests,
  clearAllTokens,
  clearToken,
  getToken,
  setToken
} from "@/services/mcp-token-store";

describe("mcp-token-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when no token exists", () => {
    expect(getToken("missing")).toBeNull();
  });

  it("stores and retrieves a token", () => {
    setToken("server-a", "token-a");
    expect(getToken("server-a")).toBe("token-a");
  });

  it("stores tokens for multiple servers independently", () => {
    setToken("a", "ta");
    setToken("b", "tb");
    expect(getToken("a")).toBe("ta");
    expect(getToken("b")).toBe("tb");
  });

  it("overwrites an existing token", () => {
    setToken("a", "old");
    setToken("a", "new");
    expect(getToken("a")).toBe("new");
  });

  it("clearToken removes a single entry", () => {
    setToken("a", "ta");
    setToken("b", "tb");
    clearToken("a");
    expect(getToken("a")).toBeNull();
    expect(getToken("b")).toBe("tb");
  });

  it("clearToken on a missing key is a no-op", () => {
    setToken("a", "ta");
    clearToken("missing");
    expect(getToken("a")).toBe("ta");
  });

  it("clearAllTokens empties the store", () => {
    setToken("a", "ta");
    setToken("b", "tb");
    clearAllTokens();
    expect(getToken("a")).toBeNull();
    expect(getToken("b")).toBeNull();
    expect(__getAllTokensForTests()).toEqual({});
  });

  it("removes the storage key when the last token is cleared", () => {
    setToken("a", "ta");
    clearToken("a");
    expect(localStorage.getItem("osml-mcp-custom-tokens")).toBeNull();
  });

  it("recovers from a corrupt payload by treating it as empty", () => {
    localStorage.setItem("osml-mcp-custom-tokens", "{not json");
    expect(getToken("a")).toBeNull();
    setToken("a", "ta");
    expect(getToken("a")).toBe("ta");
  });

  it("ignores non-string values in a parsed payload", () => {
    localStorage.setItem(
      "osml-mcp-custom-tokens",
      JSON.stringify({ a: 42, b: "ok", c: null })
    );
    expect(getToken("a")).toBeNull();
    expect(getToken("b")).toBe("ok");
    expect(getToken("c")).toBeNull();
  });
});
