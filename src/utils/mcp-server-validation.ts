// Copyright Amazon.com, Inc. or its affiliates.
import { DEFAULT_MCP_HOST_ALLOWLIST } from "@/config/mcp-allowlist";
import { siteConfig } from "@/config/site";

export interface McpUrlValidationResult {
  ok: boolean;
  reason?: string;
  /** True when the host is non-loopback; callers gate the auth-token warning on this. */
  isExternal: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PLAINTEXT_SCHEMES = new Set(["http:", "ws:"]);
const SECURE_SCHEMES = new Set(["https:", "wss:"]);

function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.toLowerCase());
}

function isValidPattern(pattern: string): boolean {
  if (!pattern) return false;
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const tail = pattern.slice(2);
    return tail.length > 0 && !tail.includes("*");
  }
  return !pattern.includes("*");
}

function hostMatchesPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p === "*") return true;
  if (p.startsWith("*.")) {
    const suffix = p.slice(1);
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return h === p;
}

function parseAllowlistOverride(raw: string): readonly string[] {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_MCP_HOST_ALLOWLIST;

  const entries = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (entries.length === 0) return DEFAULT_MCP_HOST_ALLOWLIST;

  const invalid = entries.filter((p) => !isValidPattern(p));
  if (invalid.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `MCP_HOST_ALLOWLIST contains invalid patterns; falling back to defaults. Invalid entries: ${invalid.join(", ")}`
    );
    return DEFAULT_MCP_HOST_ALLOWLIST;
  }

  return entries;
}

let cachedAllowlist: readonly string[] | null = null;
let cachedAllowlistSource: string | null = null;
function getEffectiveAllowlist(): readonly string[] {
  const source = siteConfig.mcp.hostAllowlist ?? "";
  if (cachedAllowlist !== null && cachedAllowlistSource === source) {
    return cachedAllowlist;
  }
  cachedAllowlist = parseAllowlistOverride(source);
  cachedAllowlistSource = source;
  return cachedAllowlist;
}

/** Test-only: clears the memoized allowlist between tests that mutate siteConfig. */
export function __resetAllowlistCacheForTests(): void {
  cachedAllowlist = null;
  cachedAllowlistSource = null;
}

/**
 * Validates an MCP server URL. Scheme rules are non-overrideable: https/wss
 * anywhere, http/ws only for loopback hosts, local:// always permitted.
 * Host allowlist is read from siteConfig.mcp.hostAllowlist with a default fallback.
 */
export function validateMcpServerUrl(url: string): McpUrlValidationResult {
  const trimmed = (url ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "URL is required.", isExternal: false };
  }

  if (trimmed.startsWith("local://")) {
    return { ok: true, isExternal: false };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason:
        "Enter a valid absolute URL (e.g., https://server.example.com/mcp).",
      isExternal: false
    };
  }

  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.hostname;
  const local = isLocalHost(host);
  const isExternal = !local;

  if (!SECURE_SCHEMES.has(scheme) && !PLAINTEXT_SCHEMES.has(scheme)) {
    return {
      ok: false,
      reason: `Unsupported URL scheme '${scheme}'. Use https://, wss://, or http://localhost.`,
      isExternal
    };
  }

  if (PLAINTEXT_SCHEMES.has(scheme) && !local) {
    return {
      ok: false,
      reason:
        "Plaintext http:// and ws:// are only allowed for localhost. Use https:// or wss:// for remote MCP servers.",
      isExternal
    };
  }

  const allowlist = getEffectiveAllowlist();
  const matched = allowlist.some((pattern) =>
    hostMatchesPattern(host, pattern)
  );

  if (!matched) {
    return {
      ok: false,
      reason: `Host '${host}' is not in the MCP server allowlist. Configure MCP_HOST_ALLOWLIST in your deployment if this server is trusted.`,
      isExternal
    };
  }

  return { ok: true, isExternal };
}
