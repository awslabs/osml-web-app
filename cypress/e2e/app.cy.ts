// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Application framework: the auth gate, landing page, client-side navigation,
 * the navbar, and that every viewer page mounts with its sidebar.
 */
import { getState } from "../support/helpers";

const TOOLS = [
  { title: "Image Viewer", path: "/image" },
  { title: "Map Viewer", path: "/map" },
  { title: "Globe", path: "/globe" },
  { title: "Geospatial Agent", path: "/geo-agent" }
];

const PAGE_SECTIONS = [
  {
    path: "/map",
    sections: [
      "Image Processing Jobs",
      "Data Catalog",
      "Detection Analytics",
      "Map Controls"
    ]
  },
  {
    path: "/globe",
    sections: [
      "Image Processing Jobs",
      "Data Catalog",
      "Detection Analytics",
      "Globe Controls"
    ]
  },
  {
    path: "/image",
    sections: ["Viewpoints", "Bounds", "Metadata", "Info", "Statistics"]
  },
  { path: "/geo-agent", sections: ["AI Model", "MCP Servers"] }
];

describe("Application", () => {
  describe("Authentication gate", () => {
    it("redirects an unauthenticated visit to the sign-in flow", () => {
      // Deliberately unauthenticated — no loginBypass. Empty session so the
      // client agrees with the middleware.
      cy.intercept("GET", "**/api/auth/session", { statusCode: 200, body: {} });
      cy.visit("/map", { failOnStatusCode: false });

      // The middleware sends unauthenticated users to NextAuth sign-in before
      // any OIDC bounce; we must not land on /map.
      cy.location("pathname", { timeout: 15000 }).should("not.eq", "/map");
      cy.location("pathname").should("include", "/api/auth/signin");
    });
  });

  describe("Landing page & navigation", () => {
    beforeEach(() => {
      cy.loginBypass();
      cy.visit("/");
      // Wait for client hydration before interacting: in Next dev the first
      // paint can hydrate-mismatch and React regenerates the tree; a Link click
      // landing mid-regeneration is dropped. The store appears once client JS
      // has booted.
      cy.window().its("__OSML_STORE__", { timeout: 15000 }).should("exist");
    });

    it("renders all four tool cards", () => {
      TOOLS.forEach((tool) => {
        cy.contains(tool.title).should("be.visible");
        cy.get(`a[href="${tool.path}"]`).should("exist");
      });
    });

    TOOLS.forEach((tool) => {
      it(`navigates to ${tool.path} from the ${tool.title} card`, () => {
        cy.get(`a[href="${tool.path}"]`).first().click();
        cy.location("pathname", { timeout: 15000 }).should("eq", tool.path);
      });
    });
  });

  describe("Navbar", () => {
    beforeEach(() => {
      cy.loginBypass();
    });

    it("toggles the sidebar drawer from the Menu button", () => {
      cy.visit("/map");
      getState().its("navbar.drawerOpen").should("eq", false);

      cy.get('[aria-label="Menu"]').click();
      getState().its("navbar.drawerOpen").should("eq", true);

      cy.get('[aria-label="Menu"]').click();
      getState().its("navbar.drawerOpen").should("eq", false);
    });

    it("shows authenticated controls (Logout, GitHub, preferences)", () => {
      cy.visit("/map");
      // loginBypass establishes a session, so the auth button reads "Logout".
      cy.contains("button", "Logout").should("be.visible");
      cy.get('[aria-label="Github"]').should("exist");
      cy.get('[aria-label="User preferences"]').should("not.be.disabled");
    });

    it("hides the Menu button on the landing page (no sidebar)", () => {
      cy.visit("/");
      cy.get('[aria-label="Menu"]').should("not.exist");
    });
  });

  describe("Page mount", () => {
    beforeEach(() => {
      cy.loginBypass();
      cy.mockBedrockModels();
    });

    PAGE_SECTIONS.forEach((page) => {
      it(`${page.path} mounts and shows its sidebar sections`, () => {
        cy.visit(page.path);
        // The sidebar accordion lives in the left drawer.
        cy.get('[aria-label="Menu"]', { timeout: 15000 }).click();
        page.sections.forEach((section) => {
          cy.get(`[aria-label="${section}"]`, { timeout: 15000 }).should(
            "exist"
          );
        });
      });
    });
  });
});

export {};
