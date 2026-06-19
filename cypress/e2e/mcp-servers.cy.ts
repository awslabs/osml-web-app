// Copyright Amazon.com, Inc. or its affiliates.
/**
 * MCP server management UI: adding a server (with trusted-host URL validation)
 * and removing one. The management UI lives in the geo-agent sidebar:
 * open drawer → MCP Servers accordion → Manage Servers (modal) → Add MCP Server.
 */
import { store } from "../support/helpers";

interface McpServer {
  id: string;
  name: string;
  authMode?: string;
}

function servers(s: unknown): McpServer[] {
  const redux = s as { getState: () => { mcp: { servers: McpServer[] } } };
  return redux.getState().mcp.servers;
}

function serverNames(s: unknown): string[] {
  return servers(s).map((sv) => sv.name);
}

function serverByName(s: unknown, name: string): McpServer | undefined {
  return servers(s).find((sv) => sv.name === name);
}

/** Parse the localStorage custom-token map (serverId → token). */
function parseTokenMap(raw: string): Record<string, string> {
  const parsed: unknown = JSON.parse(raw);
  return parsed as Record<string, string>;
}

// Fill the Add MCP Server form. Assumes the management modal is already open.
function fillAddServerForm(opts: {
  name: string;
  url: string;
  authMode?: "none" | "session" | "custom";
  token?: string;
}) {
  cy.contains("button", "Add MCP Server").click();
  cy.get('input[placeholder="Enter server name"]', { timeout: 15000 }).type(
    opts.name
  );
  cy.get('input[placeholder="https://server.example.com/mcp"]').type(opts.url);
  if (opts.authMode === "session") {
    cy.contains("label", "Use web app session token").click();
  } else if (opts.authMode === "custom") {
    cy.contains("label", "Custom token").click();
    cy.get('input[placeholder="Paste the token issued by this MCP server"]', {
      timeout: 10000
    }).type(opts.token ?? "");
  }
  cy.contains("button", "Add Server").should("not.be.disabled").click();
}

// Open the management modal from the geo-agent sidebar.
function openManageServers() {
  cy.visit("/geo-agent");
  cy.wait("@getModels");
  cy.get('[aria-label="Menu"]', { timeout: 15000 }).click();
  cy.get('[aria-label="MCP Servers"]', { timeout: 15000 }).click();
  cy.contains("button", "Manage Servers").click();
}

describe("MCP server management", () => {
  beforeEach(() => {
    cy.loginBypass();
    cy.mockBedrockModels();
  });

  it("adds a server with an allowlisted URL through the UI", () => {
    const NAME = "Cypress MCP Server";
    openManageServers();
    // *.amazonaws.com is on the default trusted-host allowlist.
    fillAddServerForm({ name: NAME, url: "https://my-mcp.amazonaws.com/mcp" });

    store().then((s) => {
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(serverNames(s)).to.include(NAME);
      });
    });
  });

  it("keeps Add Server disabled for a non-allowlisted URL", () => {
    openManageServers();
    cy.contains("button", "Add MCP Server").click();

    cy.get('input[placeholder="Enter server name"]', { timeout: 15000 }).type(
      "Blocked Server"
    );
    // Not on the allowlist → validation fails → submit stays disabled.
    cy.get('input[placeholder="https://server.example.com/mcp"]').type(
      "https://evil.example.org/mcp"
    );
    cy.contains("button", "Add Server").should("be.disabled");
  });

  it("deletes a server from the management list", () => {
    const NAME = "Server To Delete";
    openManageServers();
    fillAddServerForm({
      name: NAME,
      url: "https://delete-me.amazonaws.com/mcp"
    });

    store().then((s) => {
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(serverNames(s)).to.include(NAME);
      });
    });

    cy.get(`[aria-label="Delete server ${NAME}"]`, { timeout: 15000 }).click();

    store().then((s) => {
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(serverNames(s)).to.not.include(NAME);
      });
    });
  });

  describe("Authentication modes", () => {
    it("stores authMode 'none' (the default)", () => {
      const NAME = "No-Auth Server";
      openManageServers();
      fillAddServerForm({ name: NAME, url: "https://none.amazonaws.com/mcp" });

      store().then((s) => {
        cy.wrap(null, { timeout: 15000 }).should(() => {
          expect(serverByName(s, NAME)?.authMode).to.eq("none");
        });
      });
    });

    it("stores authMode 'session' when the session-token option is chosen", () => {
      const NAME = "Session Server";
      openManageServers();
      fillAddServerForm({
        name: NAME,
        url: "https://session.amazonaws.com/mcp",
        authMode: "session"
      });

      store().then((s) => {
        cy.wrap(null, { timeout: 15000 }).should(() => {
          expect(serverByName(s, NAME)?.authMode).to.eq("session");
        });
      });
    });

    it("stores a custom token in localStorage, never in the server config", () => {
      const NAME = "Custom-Token Server";
      const TOKEN = "super-secret-cypress-token";
      openManageServers();
      fillAddServerForm({
        name: NAME,
        url: "https://custom.amazonaws.com/mcp",
        authMode: "custom",
        token: TOKEN
      });

      store().then((s) => {
        cy.wrap(null, { timeout: 15000 }).should(() => {
          const server = serverByName(s, NAME);
          expect(server?.authMode).to.eq("custom");
          // The token must NOT be persisted on the server config object.
          expect(JSON.stringify(server)).to.not.contain(TOKEN);
        });
      });

      // The token lives in localStorage keyed by the server id.
      store().then((s) => {
        const server = serverByName(s, NAME);
        cy.window().then((win) => {
          // Cypress types win.localStorage as `any`; cast to the standard
          // Storage interface so getItem is typed string | null, not `any`.
          const storage = win.localStorage as Storage;
          const raw = storage.getItem("osml-mcp-custom-tokens");
          expect(raw, "token store exists").to.be.a("string");
          const map = parseTokenMap(raw as string);
          expect(map[server!.id], "token stored under server id").to.eq(TOKEN);
        });
      });
    });
  });

  describe("Enable / disable", () => {
    it("toggles a server off and back on", () => {
      const NAME = "Toggle Server";
      openManageServers();
      fillAddServerForm({
        name: NAME,
        url: "https://toggle.amazonaws.com/mcp"
      });

      // Newly added servers are enabled.
      const enabledCount = (s: unknown) =>
        (
          s as {
            getState: () => {
              mcp: { preferences: { enabledServers: McpServer[] } };
            };
          }
        ).getState().mcp.preferences.enabledServers.length;

      store().then((s) => {
        cy.wrap(null, { timeout: 15000 }).should(() =>
          expect(serverByName(s, NAME)).to.not.equal(undefined)
        );
      });

      // Toggle off → removed from enabledServers; toggle on → back.
      store().then((s) => {
        const before = enabledCount(s);
        cy.get(`[aria-label="Toggle server ${NAME}"]`, {
          timeout: 15000
        }).click();
        cy.wrap(null, { timeout: 10000 }).should(() =>
          expect(enabledCount(s)).to.eq(before - 1)
        );
        cy.get(`[aria-label="Toggle server ${NAME}"]`).click();
        cy.wrap(null, { timeout: 10000 }).should(() =>
          expect(enabledCount(s)).to.eq(before)
        );
      });
    });
  });
});

export {};
