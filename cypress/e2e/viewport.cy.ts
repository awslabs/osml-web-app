// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Viewport coordination — the map and globe share a single viewport
 * (viewport-slice). This is the highest-risk cross-cutting logic: the location
 * a user sets in one view must be the location the other view frames.
 *
 *   - map ↔ globe round-trip: drive the map, the globe inherits the location
 *   - agent-driven zoom drives the shared viewport and both views' read paths
 *   - auto-zoom preference (toggle + persistence)
 *
 * Navigation between views is CLIENT-SIDE (the store is an in-memory singleton;
 * cy.visit would reset it). The zoom-FIRES-on-detection-load behavior is a jest
 * unit test (auto-zoom.test.ts); here we cover the shared-viewport state machine
 * and the real view-object read-backs.
 */
import {
  approveTool,
  getState,
  navigateViaHome,
  openChatAndSend,
  readGlobeCameraWgs84,
  readMapCenterWgs84,
  store,
  waitForAgentReady
} from "../support/helpers";

interface ViewportShape {
  longitude: number;
  latitude: number;
  zoom: number;
  lastUpdatedBy: string;
}

describe("Viewport coordination", () => {
  beforeEach(() => {
    cy.loginBypass();
  });

  describe("map ↔ globe sync", () => {
    // Washington, DC.
    const TARGET = { longitude: -77.0369, latitude: 38.9072, zoom: 12 };

    it("globe frames the location the user set on the map", () => {
      // --- Map write path ---
      cy.visit("/map");
      cy.window()
        .its("__OSML_MAP_INSTANCE__", { timeout: 15000 })
        .should("exist")
        .then((map) => {
          const olMap = map as {
            getView: () => {
              setZoom: (z: number) => void;
              setCenter: (c: [number, number]) => void;
            };
          };
          // WGS84 → EPSG:3857 for the OL view center.
          const R = 6378137;
          const x = (TARGET.longitude * Math.PI * R) / 180;
          const y =
            R *
            Math.log(Math.tan(Math.PI / 4 + (TARGET.latitude * Math.PI) / 360));
          olMap.getView().setZoom(TARGET.zoom);
          olMap.getView().setCenter([x, y]);
        });

      // moveend is debounced 300ms before it dispatches; assert the write.
      store().then((s) => {
        const redux = s as { getState: () => { viewport: ViewportShape } };
        cy.wrap(null, { timeout: 10000 }).should(() => {
          const vp = redux.getState().viewport;
          expect(vp.lastUpdatedBy, "lastUpdatedBy").to.eq("map");
          expect(vp.longitude).to.be.closeTo(TARGET.longitude, 0.5);
          expect(vp.latitude).to.be.closeTo(TARGET.latitude, 0.5);
        });
      });

      // --- Globe read path (client-side nav keeps the in-memory store) ---
      navigateViaHome("/globe");

      cy.window()
        .its("__OSML_GLOBE_VIEWER__", { timeout: 30000 })
        .should("exist")
        .then((viewer) => {
          cy.wrap(null, { timeout: 15000 }).should(() => {
            const { longitude, latitude } = readGlobeCameraWgs84(viewer);
            expect(longitude, "globe camera longitude").to.be.closeTo(
              TARGET.longitude,
              0.75
            );
            expect(latitude, "globe camera latitude").to.be.closeTo(
              TARGET.latitude,
              0.75
            );
          });
        });
    });
  });

  describe("agent-driven viewport", () => {
    beforeEach(() => {
      cy.mockBedrockModels();
    });

    it("zoom_to_location drives the shared viewport and the globe camera", () => {
      const target = { longitude: 139.6917, latitude: 35.6895, zoom: 11 }; // Tokyo
      cy.mockBedrockToolCall("zoom_to_location", target);

      cy.visit("/globe");
      cy.wait("@getModels");
      waitForAgentReady();
      openChatAndSend("take me to tokyo");
      approveTool();

      getState().then((s) => {
        const vp = (s as { viewport: ViewportShape }).viewport;
        expect(vp.lastUpdatedBy).to.eq("agent");
        expect(vp.longitude).to.be.closeTo(target.longitude, 0.01);
        expect(vp.latitude).to.be.closeTo(target.latitude, 0.01);
        expect(vp.zoom).to.eq(target.zoom);
      });

      cy.window()
        .its("__OSML_GLOBE_VIEWER__", { timeout: 30000 })
        .should("exist")
        .then((viewer) => {
          cy.wrap(null, { timeout: 15000 }).should(() => {
            const { longitude, latitude } = readGlobeCameraWgs84(viewer);
            expect(longitude).to.be.closeTo(target.longitude, 0.75);
            expect(latitude).to.be.closeTo(target.latitude, 0.75);
          });
        });
    });

    it("zoom_to_location drives the 2D map read path (lastUpdatedBy: agent)", () => {
      const target = { longitude: -0.1276, latitude: 51.5072, zoom: 10 }; // London
      cy.mockBedrockToolCall("zoom_to_location", target);
      cy.visit("/map");
      cy.wait("@getModels");
      waitForAgentReady();

      openChatAndSend("take me to london");
      approveTool();

      getState().then((s) => {
        const vp = (s as { viewport: ViewportShape }).viewport;
        expect(vp.lastUpdatedBy, "loop-guard provenance").to.eq("agent");
        expect(vp.longitude).to.be.closeTo(target.longitude, 0.01);
        expect(vp.latitude).to.be.closeTo(target.latitude, 0.01);
      });

      // The map component must read state.viewport and move its real view there.
      cy.window()
        .its("__OSML_MAP_INSTANCE__", { timeout: 15000 })
        .should("exist")
        .then((map) => {
          cy.wrap(null, { timeout: 15000 }).should(() => {
            const { longitude, latitude } = readMapCenterWgs84(map);
            expect(longitude, "map center longitude").to.be.closeTo(
              target.longitude,
              0.5
            );
            expect(latitude, "map center latitude").to.be.closeTo(
              target.latitude,
              0.5
            );
          });
        });
    });
  });

  describe("auto-zoom preference", () => {
    beforeEach(() => {
      cy.mockBedrockModels();
    });

    it("toggles autoZoomOnLayerToggle via preferences and persists it", () => {
      cy.visit("/map");
      getState().its("settings.autoZoomOnLayerToggle").should("eq", true);

      // Flip the switch off in the User Preferences modal.
      cy.get('[aria-label="User preferences"]').click();
      cy.get("#auto-zoom-switch", { timeout: 10000 }).click();
      getState().its("settings.autoZoomOnLayerToggle").should("eq", false);

      // settings is the one persisted slice — the choice survives a reload.
      cy.reload();
      cy.window().its("__OSML_STORE__", { timeout: 15000 }).should("exist");
      getState().its("settings.autoZoomOnLayerToggle").should("eq", false);
    });
  });
});

export {};
