// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Image viewer — the viewpoint sidebar around the tile canvas: listing,
 * selection, and deletion.
 *
 * The tile canvas (WebGL) and the adjustment sliders only matter against
 * rendered pixels, so they are out of scope; here we cover the viewpoint data
 * plane and selection wiring.
 */
import { store } from "../support/helpers";

const VIEWPOINTS = {
  items: [
    {
      viewpoint_id: "vp-1",
      viewpoint_name: "Cypress Viewpoint One",
      viewpoint_status: "READY"
    },
    {
      viewpoint_id: "vp-2",
      viewpoint_name: "Cypress Viewpoint Two",
      viewpoint_status: "READY"
    }
  ]
};

// Mock the tile-server viewpoint endpoints. The list drives the sidebar; the
// per-viewpoint image endpoints are stubbed so selection doesn't error.
function interceptViewpoints(listBody: { items: unknown[] }) {
  cy.intercept("GET", "**/latest/viewpoints", {
    statusCode: 200,
    body: listBody
  }).as("listViewpoints");
  cy.intercept("DELETE", "**/latest/viewpoints/**", {
    statusCode: 200,
    body: {}
  }).as("deleteViewpoint");
  cy.intercept("GET", "**/latest/viewpoints/*/image/**", {
    statusCode: 200,
    body: {}
  });
  cy.intercept("GET", "**/latest/viewpoints/vp-*", {
    statusCode: 200,
    body: VIEWPOINTS.items[0]
  });
}

function vpNames(s: unknown): string[] {
  const redux = s as {
    getState: () => {
      imageViewer: { viewpoints: Array<{ viewpoint_name: string }> };
    };
  };
  return redux.getState().imageViewer.viewpoints.map((v) => v.viewpoint_name);
}

describe("Image viewer", () => {
  beforeEach(() => {
    cy.loginBypass();
    cy.mockBedrockModels();
  });

  it("loads viewpoints into state and renders the list", () => {
    interceptViewpoints(VIEWPOINTS);
    cy.visit("/image");

    // Viewpoints load into state (the image page fetches on mount).
    store().then((s) => {
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(vpNames(s)).to.include("Cypress Viewpoint One");
      });
    });
    // The sidebar (with the Viewpoints list) lives in the left drawer.
    cy.get('[aria-label="Menu"]').click();
    cy.contains("Cypress Viewpoint One", { timeout: 15000 }).should("exist");
  });

  it("sets selectedViewpoint in state when a viewpoint is selected", () => {
    interceptViewpoints(VIEWPOINTS);
    cy.visit("/image");
    cy.get('[aria-label="Menu"]', { timeout: 15000 }).click();

    cy.contains('[role="option"]', "Cypress Viewpoint One", {
      timeout: 15000
    }).click();

    store().then((s) => {
      const redux = s as {
        getState: () => {
          imageViewer: { selectedViewpoint: { viewpointId: string } | null };
        };
      };
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(
          redux.getState().imageViewer.selectedViewpoint?.viewpointId
        ).to.eq("vp-1");
      });
    });
  });

  it("removes a viewpoint from the list when deleted", () => {
    // First load returns two; after delete, the refetch returns one.
    let deleted = false;
    cy.intercept("GET", "**/latest/viewpoints", (req) => {
      req.reply({
        statusCode: 200,
        body: deleted ? { items: [VIEWPOINTS.items[1]] } : VIEWPOINTS
      });
    }).as("listViewpoints");
    cy.intercept("DELETE", "**/latest/viewpoints/**", (req) => {
      deleted = true;
      req.reply({ statusCode: 200, body: {} });
    }).as("deleteViewpoint");

    cy.visit("/image");
    cy.get('[aria-label="Menu"]', { timeout: 15000 }).click();
    cy.contains("Cypress Viewpoint One", { timeout: 15000 }).should("exist");

    // The per-row delete button is hover-revealed (opacity-0) but present in the
    // DOM; force-click it without needing a real hover.
    cy.contains('[role="option"]', "Cypress Viewpoint One")
      .find("button")
      .click({ force: true });

    // The DeleteConfirmationModal ("Confirm Delete") appears; confirm it.
    cy.contains("button", "Delete", { timeout: 15000 })
      .should("be.visible")
      .click();

    cy.wait("@deleteViewpoint");
    store().then((s) => {
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(vpNames(s)).to.not.include("Cypress Viewpoint One");
      });
    });
  });
});

export {};
