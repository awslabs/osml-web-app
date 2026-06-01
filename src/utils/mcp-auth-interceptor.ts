// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Fetch interceptor that attaches per-server auth to outgoing MCP requests.
 *
 * For each registered server we know the auth mode and id. On every fetch we:
 *   1. Match the request origin against the registered server map.
 *   2. Re-validate the origin against the host allowlist (defense in depth).
 *   3. Branch on auth mode: none → no header, session → forward NextAuth
 *      access token, custom → read the per-server token from mcp-token-store.
 */
import type { McpAuthMode, McpServerConfig } from "@/hooks/use-mcp";
import { getToken as getCustomToken } from "@/services/mcp-token-store";
import { validateMcpServerUrl } from "@/utils/mcp-server-validation";

interface RegisteredServer {
  serverId: string;
  mode: McpAuthMode;
}

let originalFetch: typeof fetch | undefined;
let registeredServers: Map<string, RegisteredServer> = new Map();

function buildMap(servers: McpServerConfig[]): Map<string, RegisteredServer> {
  const map = new Map<string, RegisteredServer>();
  for (const s of servers) {
    if (s.url.startsWith("local://")) continue;
    try {
      const origin = new URL(s.url).origin;
      map.set(origin, {
        serverId: s.id,
        mode: s.authMode ?? "none"
      });
    } catch {
      // Skip servers with unparseable URLs.
    }
  }
  return map;
}

export function initMcpAuthInterceptor(servers: McpServerConfig[]) {
  registeredServers = buildMap(servers);

  if (originalFetch) return;
  const native = window.fetch;
  originalFetch = native;

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

    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      return native(input, init);
    }

    // Tile server requests share the API Gateway origin but use their own
    // auth scheme; never attach the MCP bearer to them.
    if (
      urlObj.hostname.includes("execute-api") &&
      urlObj.pathname.includes("/tiles/")
    ) {
      return native(input, init);
    }

    const entry = registeredServers.get(urlObj.origin);
    if (!entry) {
      return native(input, init);
    }

    // Defense in depth: even if a server made it into the map, refuse to
    // attach credentials when its host fails the current allowlist.
    if (!validateMcpServerUrl(url).ok) {
      return native(input, init);
    }

    const token = await resolveToken(entry, native);
    if (!token) {
      return native(input, init);
    }

    // Overwrite any caller-supplied Authorization header so callers cannot
    // smuggle a different token onto an MCP request.
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return native(input, { ...init, headers });
  };
}

async function resolveToken(
  entry: RegisteredServer,
  native: typeof fetch
): Promise<string | null> {
  if (entry.mode === "none") return null;

  if (entry.mode === "custom") {
    return getCustomToken(entry.serverId);
  }

  // session: pull from NextAuth's session endpoint.
  try {
    const sessionResponse = await native("/api/auth/session");
    if (!sessionResponse.ok) return null;
    const session = (await sessionResponse.json()) as {
      accessToken?: string;
    };
    return session?.accessToken ?? null;
  } catch {
    return null;
  }
}

export function updateMcpServerUrls(servers: McpServerConfig[]) {
  registeredServers = buildMap(servers);
}

export function cleanupMcpAuthInterceptor() {
  if (originalFetch) {
    window.fetch = originalFetch;
    originalFetch = undefined as unknown as typeof fetch;
    registeredServers.clear();
  }
}
