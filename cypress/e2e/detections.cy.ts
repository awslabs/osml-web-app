// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Detection layers — exercises the seedDetectionLayer fixture, which puts a job
 * into a fully-loaded detection state without a live backend (seeds the GeoJSON
 * cache + selects the job + registers the loaded overlay layer).
 *
 * Covers canvas state: the detection layer renders into the real view objects
 * (map vector source / globe data source), and the analytics panel computes
 * stats from the cached records.
 */
import {
  getState,
  globeDataSourceNames,
  mapHasFeature,
  navigateViaHome,
  seedDetectionLayer,
  type SeedFeatureCollection,
  store
} from "../support/helpers";

const JOB = { job_id: "det-job-1", job_name: "Detections Test Job" };

function withDetections(fn: (fc: SeedFeatureCollection) => void) {
  cy.fixture("detections.json").then((fc) => fn(fc as SeedFeatureCollection));
}

describe("Detection layers", () => {
  beforeEach(() => {
    cy.loginBypass();
    cy.mockBedrockModels();
    // Isolate the test from any live backend data: the app fetches jobs on
    // load and the detection pipeline queries a STAC collection. Stub both
    // empty so the ONLY detection data is what seedDetectionLayer injects —
    // otherwise real jobs/detections would populate the cache and the panel
    // would report their counts, not ours.
    cy.intercept("GET", "**/jobs", { statusCode: 200, body: { jobs: [] } });
    cy.intercept("POST", "**/search", {
      statusCode: 200,
      body: { type: "FeatureCollection", features: [] }
    });
  });

  it("renders a seeded detection layer into the map's vector source", () => {
    cy.visit("/map");
    cy.wait("@getModels");

    withDetections((fc) => seedDetectionLayer(JOB, fc));

    cy.window()
      .its("__OSML_MAP_INSTANCE__", { timeout: 15000 })
      .then((map) => {
        cy.wrap(null, { timeout: 15000 }).should(() => {
          expect(mapHasFeature(map, "det-1"), "det-1 on map").to.eq(true);
          expect(mapHasFeature(map, "det-2"), "det-2 on map").to.eq(true);
        });
      });
  });

  it("renders a seeded detection layer onto the globe", () => {
    cy.visit("/globe");
    cy.wait("@getModels");

    withDetections((fc) => seedDetectionLayer(JOB, fc));

    cy.window()
      .its("__OSML_GLOBE_VIEWER__", { timeout: 30000 })
      .should("exist")
      .then((viewer) => {
        cy.wrap(null, { timeout: 15000 }).should(() => {
          expect(
            globeDataSourceNames(viewer).some((n) =>
              n.includes(`detection-${JOB.job_id}`)
            ),
            "detection data source on globe"
          ).to.eq(true);
        });
      });
  });

  it("computes analytics stats from the seeded detection records", () => {
    cy.visit("/map");
    cy.wait("@getModels");

    withDetections((fc) => seedDetectionLayer(JOB, fc));

    // Open the Detection Analytics accordion in the sidebar.
    cy.get('[aria-label="Menu"]').click();
    cy.get('[aria-label="Detection Analytics"]', { timeout: 15000 }).click();

    // The panel renders a per-layer stats card computed from the cached records:
    // 2 total, both above the default confidence threshold (2 visible).
    cy.contains("visible)", { timeout: 15000 }).should(
      "have.text",
      "2 features (2 visible)"
    );
  });

  it("keeps the detection layer rendered across map → globe navigation", () => {
    cy.visit("/map");
    cy.wait("@getModels");
    withDetections((fc) => seedDetectionLayer(JOB, fc));

    // Confirm it's in shared state, then navigate client-side to the globe.
    getState()
      .its("overlay.layers")
      .should("have.property", `detection-${JOB.job_id}`);

    navigateViaHome("/globe");

    cy.window()
      .its("__OSML_GLOBE_VIEWER__", { timeout: 30000 })
      .should("exist")
      .then((viewer) => {
        cy.wrap(null, { timeout: 15000 }).should(() => {
          expect(
            globeDataSourceNames(viewer).some((n) =>
              n.includes(`detection-${JOB.job_id}`)
            )
          ).to.eq(true);
        });
      });
  });

  describe("Analytics panel controls", () => {
    // Open /map, seed detections, and expand the Detection Analytics panel.
    function openAnalytics() {
      cy.visit("/map");
      cy.wait("@getModels");
      withDetections((fc) => seedDetectionLayer(JOB, fc));
      cy.get('[aria-label="Menu"]').click();
      cy.get('[aria-label="Detection Analytics"]', { timeout: 15000 }).click();
      cy.contains("visible)", { timeout: 15000 }).should(
        "have.text",
        "2 features (2 visible)"
      );
    }

    it("changes the color mode", () => {
      openAnalytics();
      // HeroUI Select listbox opens reliably via keyboard, not a click.
      cy.get('button[aria-label="Color mode"]', { timeout: 15000 })
        .focus()
        .type("{enter}");
      cy.get('[role="option"]', { timeout: 10000 })
        .contains("By Confidence")
        .click();
      getState().its("analytics.colorMode").should("eq", "confidence");
    });

    it("filters detections by the confidence threshold", () => {
      openAnalytics();
      // Both seeded detections (confidence 0.91 and 0.62) start visible.
      cy.contains("visible)", { timeout: 15000 }).should(
        "have.text",
        "2 features (2 visible)"
      );

      // Raise the threshold above 0.62: the 0.62 detection drops out, leaving
      // one visible. The confidence slider dispatches setConfidenceThreshold;
      // the panel recomputes visibleCount from the cached records.
      cy.get('[aria-label="Confidence Threshold"]', { timeout: 15000 }).should(
        "exist"
      );
      store().invoke("dispatch", {
        type: "analytics/setConfidenceThreshold",
        payload: 0.75
      });

      getState().its("analytics.confidenceThreshold").should("eq", 0.75);
      cy.contains("visible)", { timeout: 15000 }).should(
        "have.text",
        "2 features (1 visible)"
      );
    });
  });
});

export {};
