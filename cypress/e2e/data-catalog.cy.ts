// Copyright Amazon.com, Inc. or its affiliates.
/**
 * STAC data catalog — browsing/searching the catalog, and plotting a catalog
 * item onto the map and globe.
 *
 * "Browsing & search" covers the catalog data plane (load collections, search,
 * agent list tool, error state). "Plotting onto map & globe" covers the agent
 * draw_feature(stacUrl) flow: it stores a *reference* in overlay state; each
 * view then independently fetches GET /collections/{id}/items/{itemId} and
 * renders the geometry into its native view object. Cross-view tests navigate
 * CLIENT-SIDE so the in-memory overlay reference survives.
 */
import {
  approveTool,
  globeDataSourceNames,
  mapHasFeature,
  navigateViaHome,
  openChatAndSend,
  readGlobeCameraWgs84,
  readMapCenterWgs84,
  store,
  waitForAgentReady
} from "../support/helpers";

// ─── Browsing & search fixtures ──────────────────────────────────────────────

const COLLECTIONS = {
  collections: [
    {
      id: "airports",
      type: "Collection",
      stac_version: "1.0.0",
      description: "Airport imagery",
      title: "Airports",
      license: "proprietary",
      extent: {
        spatial: { bbox: [[-180, -90, 180, 90]] },
        temporal: { interval: [[null, null]] }
      },
      links: []
    }
  ]
};

const SEARCH_RESPONSE = {
  type: "FeatureCollection",
  features: [],
  context: { matched: 0, returned: 0, limit: 10 },
  numMatched: 0
};

// The catalog load fans out: GET /collections, then per-collection
// GET /collections/{id} (details) and POST /search (item count). Mock all three.
function interceptCatalog(opts: { collectionsStatus?: number } = {}) {
  cy.intercept("GET", "**/collections", {
    statusCode: opts.collectionsStatus ?? 200,
    body:
      opts.collectionsStatus && opts.collectionsStatus >= 400 ? {} : COLLECTIONS
  }).as("getCollections");
  cy.intercept("GET", "**/collections/*", {
    statusCode: 200,
    body: { ...COLLECTIONS.collections[0], summaries: {}, item_assets: {} }
  });
  cy.intercept("POST", "**/search", {
    statusCode: 200,
    body: SEARCH_RESPONSE
  }).as("search");
}

// Open the Map sidebar and expand the Data Catalog accordion.
function openDataCatalog() {
  cy.get('[aria-label="Menu"]', { timeout: 15000 }).click();
  cy.get('[aria-label="Data Catalog"]', { timeout: 15000 }).click();
}

// ─── Plotting fixtures ───────────────────────────────────────────────────────

const FEATURE_ID = "stac-test-feature";
const STAC_URL = "https://stac.example.com/collections/airports/items/test-1";
// Centroid of the fixture polygon (central Paris).
const CENTROID = { longitude: 2.35, latitude: 48.86 };

function interceptStacItem() {
  cy.intercept("GET", "**/collections/airports/items/test-1", {
    statusCode: 200,
    fixture: "stac-item.json"
  }).as("getItem");
}

// Script the agent to plot the STAC item.
function plotStacViaAgent() {
  cy.mockBedrockToolCall("draw_feature", {
    stacUrl: STAC_URL,
    id: FEATURE_ID,
    description: "Cypress STAC polygon"
  });
}

function agentStacRefs(s: unknown) {
  const redux = s as {
    getState: () => {
      overlay: {
        inlineFeatures: Record<
          string,
          Array<{
            id: string;
            properties: { dataSource?: string; stacUrl?: string };
          }>
        >;
      };
    };
  };
  return redux.getState().overlay.inlineFeatures["agent-features"] ?? [];
}

describe("Data catalog", () => {
  beforeEach(() => {
    cy.loginBypass();
    cy.mockBedrockModels();
  });

  describe("Browsing & search", () => {
    it("loads collections into state and renders them", () => {
      interceptCatalog();
      cy.visit("/map");
      cy.wait("@getModels");
      openDataCatalog();

      cy.wait("@getCollections");
      store().then((s) => {
        const redux = s as {
          getState: () => {
            dataCatalog: { collections: { data: Array<{ id: string }> } };
          };
        };
        cy.wrap(null, { timeout: 15000 }).should(() => {
          const data = redux.getState().dataCatalog.collections.data;
          expect(data.some((c) => c.id === "airports")).to.eq(true);
        });
      });
      cy.contains("Airports", { timeout: 15000 }).should("exist");
    });

    it("sends the search query in the POST /search body", () => {
      interceptCatalog();
      cy.visit("/map");
      cy.wait("@getModels");
      openDataCatalog();
      cy.wait("@getCollections");

      cy.get('[aria-label="Data Catalog Options"]', { timeout: 15000 }).should(
        "exist"
      );
      cy.contains("Search").click();
      cy.get('input[placeholder="e.g., Cuba, Landsat, forest..."]', {
        timeout: 15000
      })
        .should("be.visible")
        .type("Landsat");
      // Two "Search" buttons exist (the tab and the action). Click the action.
      cy.get('button:not([role="tab"])').contains("Search").click();

      // /search also fires during collection load (item counts), so assert that
      // SOME /search request carried the user's full-text query (`q`).
      cy.wait("@search");
      cy.get("@search.all", { timeout: 15000 }).should((interceptions) => {
        const calls = interceptions as unknown as Array<{
          request: { body: unknown };
        }>;
        const hasQuery = calls.some((c) =>
          JSON.stringify(c.request.body).includes("Landsat")
        );
        expect(hasQuery, "a /search request carried the query").to.eq(true);
      });
    });

    it("lists collections via the agent tool", () => {
      interceptCatalog();
      cy.mockBedrockToolCall("list_stac_collections", {});
      cy.visit("/map");
      cy.wait("@getModels");
      waitForAgentReady();

      openChatAndSend("what collections exist");
      approveTool();

      // The tool hits the real catalog service → GET /collections fires.
      cy.wait("@getCollections");
    });

    it("renders an error (not a crash) when collections fail to load", () => {
      interceptCatalog({ collectionsStatus: 500 });
      cy.visit("/map");
      cy.wait("@getModels");
      openDataCatalog();

      cy.wait("@getCollections");
      store().then((s) => {
        const redux = s as {
          getState: () => {
            dataCatalog: {
              collections: { error: string | null; data: unknown[] };
            };
          };
        };
        cy.wrap(null, { timeout: 15000 }).should(() => {
          const c = redux.getState().dataCatalog.collections;
          // Error recorded OR list simply empty — both graceful (no crash).
          expect(c.error !== null || c.data.length === 0).to.eq(true);
        });
      });
      cy.get('[aria-label="Menu"]').should("exist"); // app still alive
    });

    it("toggles the map-view (bbox) search filter", () => {
      interceptCatalog();
      cy.visit("/map");
      cy.wait("@getModels");
      openDataCatalog();
      cy.wait("@getCollections");

      cy.get('[aria-label="Data Catalog Options"]', { timeout: 15000 }).should(
        "exist"
      );
      cy.contains("Search").click();

      cy.contains("Filter by current map view").click();
      store()
        .invoke("getState")
        .its("dataCatalog.search.filters.useBboxFilter")
        .should("eq", true);
    });

    it("browses search results and opens an item's details", () => {
      interceptCatalog();
      // Return a real item so the browser has something to render.
      cy.intercept("POST", "**/search", {
        statusCode: 200,
        body: {
          type: "FeatureCollection",
          numMatched: 1,
          context: { matched: 1, returned: 1, limit: 10 },
          features: [
            {
              type: "Feature",
              id: "item-42",
              collection: "airports",
              properties: {
                title: "Runway Scene 42",
                datetime: "2026-01-01T00:00:00Z"
              },
              geometry: { type: "Point", coordinates: [0, 0] },
              assets: {}
            }
          ]
        }
      }).as("searchItems");
      cy.visit("/map");
      cy.wait("@getModels");
      openDataCatalog();
      cy.wait("@getCollections");

      cy.contains("Search").click();
      cy.get('button:not([role="tab"])').contains("Search").click();
      cy.wait("@searchItems");

      // The result renders; open its details modal and confirm it shows.
      cy.get('[aria-label="View details for Runway Scene 42"]', {
        timeout: 15000
      }).click();
      cy.get('[role="dialog"]', { timeout: 15000 })
        .contains("Runway Scene 42")
        .should("exist");
    });
  });

  describe("Plotting onto map & globe", () => {
    beforeEach(() => {
      interceptStacItem();
      plotStacViaAgent();
    });

    it("stores a STAC reference in overlay state (not the geometry)", () => {
      cy.visit("/map");
      cy.wait("@getModels");
      waitForAgentReady();

      openChatAndSend("plot that item");
      approveTool();

      store().then((s) => {
        cy.wrap(null, { timeout: 15000 }).should(() => {
          const ref = agentStacRefs(s).find((f) => f.id === FEATURE_ID);
          expect(ref, "agent-features reference exists").to.not.equal(
            undefined
          );
          expect(ref?.properties.dataSource).to.eq("stac_url");
          expect(ref?.properties.stacUrl).to.eq(STAC_URL);
        });
      });
    });

    it("the map fetches the item and adds it to its vector source", () => {
      cy.visit("/map");
      cy.wait("@getModels");
      waitForAgentReady();

      openChatAndSend("plot that item");
      approveTool();

      cy.wait("@getItem");
      cy.window()
        .its("__OSML_MAP_INSTANCE__")
        .then((map) => {
          cy.wrap(null, { timeout: 15000 }).should(() => {
            expect(
              mapHasFeature(map, FEATURE_ID),
              "feature added to an OL vector source"
            ).to.eq(true);
          });
        });
    });

    it("the globe fetches the item and adds a stac-* data source", () => {
      cy.visit("/globe");
      cy.wait("@getModels");
      waitForAgentReady();

      openChatAndSend("plot that item");
      approveTool();

      cy.wait("@getItem");
      cy.window()
        .its("__OSML_GLOBE_VIEWER__")
        .then((viewer) => {
          cy.wrap(null, { timeout: 15000 }).should(() => {
            expect(
              globeDataSourceNames(viewer).some(
                (n) => n === `stac-${FEATURE_ID}`
              ),
              "stac data source present on globe"
            ).to.eq(true);
          });
        });
    });

    it("renders on the globe after being plotted on the map", () => {
      cy.visit("/map");
      cy.wait("@getModels");
      waitForAgentReady();

      openChatAndSend("plot that item");
      approveTool();
      cy.wait("@getItem");

      navigateViaHome("/globe");

      cy.window()
        .its("__OSML_GLOBE_VIEWER__", { timeout: 30000 })
        .should("exist")
        .then((viewer) => {
          cy.wrap(null, { timeout: 15000 }).should(() => {
            expect(
              globeDataSourceNames(viewer).some(
                (n) => n === `stac-${FEATURE_ID}`
              )
            ).to.eq(true);
          });
        });
    });

    it("renders on the map after being plotted on the globe", () => {
      cy.visit("/globe");
      cy.wait("@getModels");
      waitForAgentReady();

      openChatAndSend("plot that item");
      approveTool();
      cy.wait("@getItem");

      navigateViaHome("/map");

      cy.window()
        .its("__OSML_MAP_INSTANCE__", { timeout: 30000 })
        .should("exist")
        .then((map) => {
          cy.wrap(null, { timeout: 15000 }).should(() => {
            expect(mapHasFeature(map, FEATURE_ID)).to.eq(true);
          });
        });
    });

    it("location stays consistent: plot on map → globe frames the item", () => {
      cy.visit("/map");
      cy.wait("@getModels");
      waitForAgentReady();

      openChatAndSend("plot that item");
      approveTool();
      cy.wait("@getItem");

      // Map auto-zooms to the feature → moveend writes the shared viewport.
      store().then((s) => {
        const redux = s as {
          getState: () => { viewport: { latitude: number; longitude: number } };
        };
        cy.wrap(null, { timeout: 15000 }).should(() => {
          const vp = redux.getState().viewport;
          expect(vp.longitude).to.be.closeTo(CENTROID.longitude, 0.5);
          expect(vp.latitude).to.be.closeTo(CENTROID.latitude, 0.5);
        });
      });

      navigateViaHome("/globe");
      cy.window()
        .its("__OSML_GLOBE_VIEWER__", { timeout: 30000 })
        .should("exist")
        .then((viewer) => {
          cy.wrap(null, { timeout: 15000 }).should(() => {
            const { longitude, latitude } = readGlobeCameraWgs84(viewer);
            expect(longitude).to.be.closeTo(CENTROID.longitude, 0.75);
            expect(latitude).to.be.closeTo(CENTROID.latitude, 0.75);
          });
        });
    });

    it("location stays consistent: plot on globe → map frames the item", () => {
      // The globe flies to a newly-plotted STAC feature, writing the shared
      // viewport (updatedBy "globe"), so the map inherits the location on
      // navigation.
      cy.visit("/globe");
      cy.wait("@getModels");
      waitForAgentReady();

      openChatAndSend("plot that item");
      approveTool();
      cy.wait("@getItem");

      store().then((s) => {
        const redux = s as {
          getState: () => {
            viewport: {
              latitude: number;
              longitude: number;
              lastUpdatedBy: string;
            };
          };
        };
        cy.wrap(null, { timeout: 15000 }).should(() => {
          const vp = redux.getState().viewport;
          expect(vp.lastUpdatedBy, "globe should author the viewport").to.eq(
            "globe"
          );
          expect(vp.longitude).to.be.closeTo(CENTROID.longitude, 0.75);
          expect(vp.latitude).to.be.closeTo(CENTROID.latitude, 0.75);
        });
      });

      navigateViaHome("/map");
      cy.window()
        .its("__OSML_MAP_INSTANCE__", { timeout: 30000 })
        .should("exist")
        .then((map) => {
          cy.wrap(null, { timeout: 15000 }).should(() => {
            const { longitude, latitude } = readMapCenterWgs84(map);
            expect(longitude).to.be.closeTo(CENTROID.longitude, 0.75);
            expect(latitude).to.be.closeTo(CENTROID.latitude, 0.75);
          });
        });
    });
  });

  describe("Deletion via agent", () => {
    it("deletes a STAC collection through the destructive-confirm flow", () => {
      interceptCatalog();
      cy.intercept("DELETE", "**/collections/airports", {
        statusCode: 200,
        body: {}
      }).as("deleteCollection");
      cy.mockBedrockToolCall("delete_stac_collection", {
        collection_id: "airports"
      });

      cy.visit("/map");
      cy.wait("@getModels");
      waitForAgentReady();

      openChatAndSend("delete the airports collection");
      // Not auto-approved: tool-approval modal, then destructive confirm.
      approveTool();
      cy.contains("button", "Delete", { timeout: 15000 })
        .scrollIntoView()
        .click({ force: true });

      cy.wait("@deleteCollection");
    });
  });
});

export {};
