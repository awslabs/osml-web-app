// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Shared helpers for the e2e specs. These wrap the test-only window hooks
 * (__OSML_STORE__, __OSML_MAP_INSTANCE__, __OSML_GLOBE_VIEWER__) and the common
 * chat-agent interaction so specs stay focused on behavior, not plumbing.
 */

// ─── Redux store access ──────────────────────────────────────────────────────

/** The Redux store exposed on window (prod-gated in src/store/store.ts). */
export const store = () => cy.window().its("__OSML_STORE__");

/** Current Redux state. Chainable: `getState().its("viewport.zoom")`. */
export const getState = () => store().invoke("getState");

// ─── Readiness ───────────────────────────────────────────────────────────────

/**
 * Wait until the geospatial agent is ready to take input: a model is selected
 * and MCP has initialised. Gates chat interactions.
 */
export function waitForAgentReady() {
  getState().its("mcp.initialized", { timeout: 30000 }).should("eq", true);
}

// ─── Chat-agent interaction ──────────────────────────────────────────────────

const WIDGET_INPUT =
  'input[placeholder="Ask about geospatial data, coordinates, maps..."]';

/**
 * Open the floating chat widget (map/globe pages), type a prompt and send it.
 * The agent response is always scripted in tests, so the prompt text is
 * irrelevant to what runs.
 */
export function openChatAndSend(prompt = "do the thing") {
  cy.get('[aria-label="Open AI Chat"]', { timeout: 15000 }).click();
  cy.get(WIDGET_INPUT, { timeout: 20000 })
    .should("be.visible")
    .should("not.be.disabled")
    .type(prompt);
  cy.get('button[type="submit"]').contains("Send").click();
}

/** Send a prompt in the full /geo-agent chat (no widget toggle). */
export function sendInFullChat(prompt: string) {
  cy.get(WIDGET_INPUT, { timeout: 20000 })
    .should("be.visible")
    .should("not.be.disabled")
    .type(prompt);
  cy.get('button[type="submit"]').contains("Send").click();
}

/** Click Approve in the tool-approval modal. */
export function approveTool() {
  cy.contains("Approve", { timeout: 15000 }).should("be.visible").click();
}

// ─── View-object geometry read-back ──────────────────────────────────────────

const WEB_MERCATOR_MAX = 20037508.34;

/** Convert an OpenLayers EPSG:3857 center to WGS84 degrees. */
export function webMercatorToWgs84(x: number, y: number) {
  const longitude = (x / WEB_MERCATOR_MAX) * 180;
  const latDeg = (y / WEB_MERCATOR_MAX) * 180;
  const latitude =
    (180 / Math.PI) *
    (2 * Math.atan(Math.exp((latDeg * Math.PI) / 180)) - Math.PI / 2);
  return { longitude, latitude };
}

/** Read the OpenLayers map center back as WGS84 degrees. */
export function readMapCenterWgs84(map: unknown) {
  const olMap = map as {
    getView: () => { getCenter: () => [number, number] };
  };
  const [x, y] = olMap.getView().getCenter();
  return webMercatorToWgs84(x, y);
}

/** Read the Cesium globe camera position back as WGS84 degrees. */
export function readGlobeCameraWgs84(viewer: unknown) {
  const v = viewer as {
    camera: { positionCartographic: { longitude: number; latitude: number } };
  };
  const carto = v.camera.positionCartographic;
  return {
    longitude: (carto.longitude * 180) / Math.PI,
    latitude: (carto.latitude * 180) / Math.PI
  };
}

/** True if any OpenLayers vector source on the map holds a feature with `id`. */
export function mapHasFeature(map: unknown, id: string): boolean {
  const olMap = map as {
    getLayers: () => {
      getArray: () => Array<{
        getSource?: () => { getFeatureById?: (id: string) => unknown } | null;
      }>;
    };
  };
  return olMap
    .getLayers()
    .getArray()
    .some((layer) => Boolean(layer.getSource?.()?.getFeatureById?.(id)));
}

/** Names of all Cesium data sources currently on the globe. */
export function globeDataSourceNames(viewer: unknown): string[] {
  const v = viewer as {
    dataSources: { length: number; get: (i: number) => { name?: string } };
  };
  const names: string[] = [];
  for (let i = 0; i < v.dataSources.length; i++) {
    names.push(v.dataSources.get(i).name ?? "");
  }
  return names;
}

// ─── Seeded detection layer ──────────────────────────────────────────────────

/** Minimal job shape for seeding a detection layer. */
export interface SeedJob {
  job_id: string;
  job_name?: string;
  status?: string;
}

/** A GeoJSON FeatureCollection of detection features (polygons/points). */
export interface SeedFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string;
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
  }>;
}

/**
 * Put a job into a fully-loaded detection state WITHOUT a live backend, so
 * analytics, detection-layer render, and restyle become testable.
 *
 * Mirrors the cached fast-path of the fetchGeoJSONData thunk: seed the GeoJSON
 * cache for `detection-{job_id}`, select the job, and register the loaded
 * detection overlay layer (source "detection", layerType "vector",
 * loading false). After this the map/globe detection hooks render the features
 * and the analytics panel computes stats from the cached records.
 *
 * Requires the page to be loaded first (the cache + store are read off window).
 */
export function seedDetectionLayer(
  job: SeedJob,
  featureCollection: SeedFeatureCollection
) {
  const layerId = `detection-${job.job_id}`;

  type CacheWindow = {
    __OSML_GEOJSON_CACHE__?: {
      set: (id: string, data: SeedFeatureCollection) => void;
    };
    __OSML_STORE__: { dispatch: (a: unknown) => void };
  };

  // The cache singleton is created lazily on the first getInstance() call,
  // which the map/globe detection hooks make during render. Wait for it to be
  // exposed on window before seeding (a view may still be mounting).
  cy.window({ timeout: 30000 })
    .should((win) => {
      expect(
        (win as unknown as CacheWindow).__OSML_GEOJSON_CACHE__,
        "geojson cache exposed"
      ).to.not.equal(undefined);
    })
    .then((win) => {
      const w = win as unknown as CacheWindow;
      w.__OSML_GEOJSON_CACHE__!.set(layerId, featureCollection);

      // Register the loaded detection layer. Presence of a `detection-<jobId>`
      // record in overlay.layers is the SOLE trigger for the map/globe
      // detection renderers and the analytics panel — selection is NOT
      // required. We deliberately do NOT dispatch setSelectedJobs: that would
      // fire the fetchDataMiddleware → fetchGeoJSONData thunk, which queries
      // the (unmocked) detection STAC collection and overwrites our seeded
      // cache entry. Seeding the cache + overlay record directly keeps the
      // seeded geometry authoritative and the test deterministic.
      w.__OSML_STORE__.dispatch({
        type: "overlay/addLayer",
        payload: {
          id: layerId,
          name: `Detection: ${job.job_id}`,
          source: "detection",
          zIndex: 10,
          featureCount: featureCollection.features.length,
          metadata: { jobId: job.job_id, loading: false, layerType: "vector" }
        }
      });
    });
}

// ─── Client-side navigation ──────────────────────────────────────────────────

/**
 * Navigate between views CLIENT-SIDE via the landing-page links (never
 * cy.visit). The Redux store is an in-memory singleton; only `settings` is
 * persisted, so a full reload resets viewport/overlay state. Real users
 * navigate via in-app links, which keep the store alive — so tests must too.
 */
export function navigateViaHome(targetPath: string) {
  clickLinkUntilAt('a[href="/"]', "/");
  clickLinkUntilAt(`a[href="${targetPath}"]`, targetPath);
}

/**
 * Click an in-app link and confirm navigation. On heavy pages (Cesium globe) a
 * click can land before the router is ready and be dropped, so retry until the
 * location settles. Each attempt re-clicks only while we have not arrived and
 * the link is still in the DOM — once a transition lands, the source-page link
 * detaches (e.g. the home page's `a[href="/globe"]` card is gone on /globe) and
 * re-clicking would chase a stale node.
 */
function clickLinkUntilAt(linkSelector: string, expectedPath: string) {
  const attempt = (triesLeft: number) => {
    cy.location("pathname").then((current) => {
      if (current === expectedPath) return; // already arrived; nothing to click
      cy.document().then((doc) => {
        // Only click while the source-page link is still attached; once the
        // transition lands it is gone and re-clicking would chase a stale node.
        if (doc.querySelector(linkSelector)) {
          cy.get(linkSelector).first().click({ force: true });
        }
      });
      if (triesLeft > 0) {
        cy.location("pathname", { timeout: 8000 }).then((path) => {
          if (path !== expectedPath) attempt(triesLeft - 1);
        });
      }
    });
  };
  attempt(4);
  cy.location("pathname", { timeout: 15000 }).should("eq", expectedPath);
}
