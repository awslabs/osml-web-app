// Copyright Amazon.com, Inc. or its affiliates.

/**
 * Per-server custom MCP auth tokens. Stored in localStorage under a single
 * namespaced key so they never enter Redux (and never appear in DevTools,
 * persistence dumps, or error reports).
 */

const STORAGE_KEY = "osml-mcp-custom-tokens";

type TokenMap = Record<string, string>;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readMap(): TokenMap {
  if (!isBrowser()) return {};
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: TokenMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") result[k] = v;
      }
      return result;
    }
  } catch {
    // Corrupt payload: drop it on the next write.
  }
  return {};
}

function writeMap(map: TokenMap): void {
  if (!isBrowser()) return;
  if (Object.keys(map).length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function getToken(serverId: string): string | null {
  return readMap()[serverId] ?? null;
}

export function setToken(serverId: string, token: string): void {
  const map = readMap();
  map[serverId] = token;
  writeMap(map);
}

export function clearToken(serverId: string): void {
  const map = readMap();
  if (serverId in map) {
    delete map[serverId];
    writeMap(map);
  }
}

export function clearAllTokens(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(STORAGE_KEY);
}

/** Test-only: returns the current map; do not call from production code. */
export function __getAllTokensForTests(): TokenMap {
  return readMap();
}
