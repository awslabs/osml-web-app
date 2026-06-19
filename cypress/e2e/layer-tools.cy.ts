// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Agent layer-manipulation tools: style_layer, reorder_layers, and
 * set_job_visibility. These mutate user-visible map/globe layer state through
 * the scripted-tool → approval → handler → Redux path.
 *
 *   - style_layer: restyle a detection layer; the per-job style is the single
 *     source both the map and globe renderers read, so it stays consistent
 *     across views (verified via client-side navigation).
 *   - reorder_layers: reorder overlay.layerOrder.
 *   - set_job_visibility: show/hide a job's layers (the agent equivalent of the
 *     sidebar show/hide button).
 */
import {
  approveTool,
  getState,
  navigateViaHome,
  openChatAndSend,
  seedDetectionLayer,
  type SeedFeatureCollection,
  sendInFullChat,
  waitForAgentReady
} from "../support/helpers";

function withDetections(fn: (fc: SeedFeatureCollection) => void) {
  cy.fixture("detections.json").then((fc) => fn(fc as SeedFeatureCollection));
}

describe("Layer tools", () => {
  beforeEach(() => {
    cy.loginBypass();
    cy.mockBedrockModels();
    // Keep live backend data out of the GeoJSON cache / jobs list.
    cy.intercept("GET", "**/jobs", { statusCode: 200, body: { jobs: [] } });
    cy.intercept("POST", "**/search", {
      statusCode: 200,
      body: { type: "FeatureCollection", features: [] }
    });
  });

  it("style_layer restyles a detection layer consistently across map and globe", () => {
    const JOB = { job_id: "style-job", job_name: "Style Job" };
    const NEW = { color: "#123456", opacity: 0.33 };
    cy.mockBedrockToolCall("style_layer", {
      layer_id: `detection-${JOB.job_id}`,
      color: NEW.color,
      opacity: NEW.opacity
    });

    cy.visit("/map");
    cy.wait("@getModels");
    waitForAgentReady();
    withDetections((fc) => seedDetectionLayer(JOB, fc));

    openChatAndSend("recolor that layer");
    approveTool();

    // The per-job style lands in jobs.selection.layerStyles (what both the map
    // and globe detection renderers read when drawing features).
    getState()
      .its(`jobs.selection.layerStyles.${JOB.job_id}`)
      .should("deep.equal", NEW);

    // It survives navigation to the globe — both views read the same style.
    navigateViaHome("/globe");
    cy.window().its("__OSML_STORE__", { timeout: 15000 }).should("exist");
    getState()
      .its(`jobs.selection.layerStyles.${JOB.job_id}`)
      .should("deep.equal", NEW);
  });

  it("reorder_layers updates the overlay layer order", () => {
    const A = { job_id: "layer-a", job_name: "Layer A" };
    const B = { job_id: "layer-b", job_name: "Layer B" };
    const idA = `detection-${A.job_id}`;
    const idB = `detection-${B.job_id}`;
    cy.mockBedrockToolCall("reorder_layers", { layer_order: [idB, idA] });

    cy.visit("/map");
    cy.wait("@getModels");
    waitForAgentReady();
    withDetections((fc) => seedDetectionLayer(A, fc));
    withDetections((fc) => seedDetectionLayer(B, fc));

    // Both layers are registered (A added before B).
    getState()
      .its("overlay.layerOrder")
      .should((order: string[]) => {
        expect(order).to.include(idA);
        expect(order).to.include(idB);
      });

    openChatAndSend("put layer B on top");
    approveTool();

    // The agent's order is applied verbatim.
    getState().its("overlay.layerOrder").should("deep.equal", [idB, idA]);
  });

  const VIS_JOB = {
    job_id: "vis-job",
    job_name: "Visibility Job",
    status: "SUCCESS",
    updated_at: "2026-06-12T00:00:00Z"
  };

  // Open /geo-agent (full chat, no map/globe canvas — its input is always
  // present) with the job loaded, ready to drive set_job_visibility. Assertions
  // are on Redux overlay state, so the page choice doesn't affect them.
  function openAgentWithJob() {
    cy.intercept("GET", "**/jobs", {
      statusCode: 200,
      body: { jobs: [VIS_JOB] }
    });
    cy.visit("/geo-agent");
    cy.wait("@getModels");
    waitForAgentReady();
    getState()
      .its("jobs.jobsList.jobs")
      .should((jobs: Array<{ job_id: string }>) => {
        expect(jobs.some((j) => j.job_id === VIS_JOB.job_id)).to.eq(true);
      });
  }

  it("set_job_visibility shows a job's detection layer", () => {
    openAgentWithJob();
    cy.mockBedrockToolCall("set_job_visibility", {
      job_id: VIS_JOB.job_id,
      visible: true
    });
    sendInFullChat("show that job");
    approveTool();
    getState()
      .its("overlay.layers")
      .should("have.property", `detection-${VIS_JOB.job_id}`);
  });

  it("set_job_visibility hides a previously-shown job's detection layer", () => {
    openAgentWithJob();
    // Show first so there is a layer to hide.
    cy.mockBedrockToolCall("set_job_visibility", {
      job_id: VIS_JOB.job_id,
      visible: true
    });
    sendInFullChat("show that job");
    approveTool();
    getState()
      .its("overlay.layers")
      .should("have.property", `detection-${VIS_JOB.job_id}`);

    // Wait for the chat to go idle (input re-enabled) after the first tool
    // chain resolves, before sending the second message.
    cy.get(
      'input[placeholder="Ask about geospatial data, coordinates, maps..."]',
      { timeout: 20000 }
    ).should("not.be.disabled");

    // Then hide it; the overlay layer is removed.
    cy.mockBedrockToolCall("set_job_visibility", {
      job_id: VIS_JOB.job_id,
      visible: false
    });
    sendInFullChat("hide that job");
    approveTool();
    getState()
      .its("overlay.layers")
      .should("not.have.property", `detection-${VIS_JOB.job_id}`);
  });
});

export {};
