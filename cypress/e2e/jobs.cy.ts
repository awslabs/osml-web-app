// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Image processing jobs (Model Runner): the job lifecycle and the shared layer
 * style state.
 *
 *   - submit a job via the agent tool → it lands in state
 *   - refresh the jobs list from the sidebar
 *   - delete a job via the agent → approve → destructive confirm → clean
 *     teardown (job removed AND its layer style cleared)
 *   - a failed submission adds no job
 *   - a restyle is consistent across map and globe (shared style state)
 *
 * Deferred (need a populated GeoJSON cache / detection geometry on the canvas):
 * detection-layer render on map & globe, auto-zoom on results. The styling
 * source of truth (jobs.selection.layerStyles) is exercised by the delete
 * teardown and the cross-view restyle; the jest auto-zoom unit test covers the
 * zoom math.
 */
import {
  approveTool,
  getState,
  navigateViaHome,
  openChatAndSend,
  store,
  waitForAgentReady
} from "../support/helpers";

const JOB = {
  job_id: "job-aaa-111",
  job_name: "Cypress Test Job A",
  status: "SUCCESS",
  image_status: "SUCCESS",
  updated_at: "2026-06-09T12:00:00Z",
  output_bucket: "mr-bucket-sink-000000000000"
};

// Mock the read side of jobs. `jobsBody` controls what GET /jobs returns.
function interceptJobReads(jobsBody: { jobs: unknown[] }) {
  cy.intercept("GET", "**/jobs", { statusCode: 200, body: jobsBody }).as(
    "listJobs"
  );
  // submitJob may probe S3 to resolve an output bucket.
  cy.intercept("GET", "**/s3/buckets", {
    statusCode: 200,
    body: { buckets: [{ name: "mr-bucket-sink-000000000000" }] }
  });
}

function jobInList(s: unknown, jobId: string): boolean {
  const redux = s as {
    getState: () => { jobs: { jobsList: { jobs: Array<{ job_id: string }> } } };
  };
  return redux.getState().jobs.jobsList.jobs.some((j) => j.job_id === jobId);
}

describe("Image processing jobs", () => {
  beforeEach(() => {
    cy.loginBypass();
    cy.mockBedrockModels();
  });

  it("submits a job via the agent tool and lands it in the jobs list", () => {
    // After submit, the service POSTs job + viewpoint, then GET /jobs. Return
    // the new job from the list endpoint so it shows up in state.
    interceptJobReads({ jobs: [JOB] });
    cy.intercept("POST", "**/jobs", { statusCode: 200, body: JOB }).as(
      "createJob"
    );
    cy.intercept("POST", "**/latest/viewpoints", {
      statusCode: 201,
      body: { viewpoint_id: JOB.job_id }
    });

    cy.mockBedrockToolCall("submit_image_processing_job", {
      job_name: JOB.job_name,
      image_url: "s3://my-bucket/scene.tif",
      model_endpoint_name: "aircraft-detector"
    });

    cy.visit("/map");
    cy.wait("@getModels");
    waitForAgentReady();

    openChatAndSend();
    approveTool();

    cy.wait("@createJob");
    store().then((s) => {
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(jobInList(s, JOB.job_id)).to.eq(true);
      });
    });
  });

  it("refreshes the jobs list from the sidebar", () => {
    interceptJobReads({ jobs: [JOB] });
    cy.visit("/map");
    cy.wait("@getModels");

    // Open the drawer and the Image Processing Jobs accordion, then refresh.
    cy.get('[aria-label="Menu"]').click();
    cy.get('[aria-label="Image Processing Jobs"]', { timeout: 15000 }).click();
    cy.get('[aria-label="Refresh jobs list"]', { timeout: 15000 }).click();

    cy.wait("@listJobs");
    store().then((s) => {
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(jobInList(s, JOB.job_id)).to.eq(true);
      });
    });
    cy.contains(JOB.job_name).should("exist");
  });

  it("deletes a job via the agent tool and clears it and its style cleanly", () => {
    // Job present initially; after delete, GET /jobs returns empty.
    let deleted = false;
    cy.intercept("GET", "**/jobs", (req) => {
      req.reply({ statusCode: 200, body: { jobs: deleted ? [] : [JOB] } });
    }).as("listJobs");
    cy.intercept("DELETE", "**/jobs/**", (req) => {
      deleted = true;
      req.reply({ statusCode: 200, body: { jobId: JOB.job_id } });
    }).as("deleteJob");

    cy.mockBedrockToolCall("delete_image_processing_job", {
      job_id: JOB.job_id
    });

    cy.visit("/map");
    cy.wait("@getModels");
    waitForAgentReady();

    // The app fetches jobs on load (GET /jobs → [JOB]). Wait for the job, then
    // give it a layer style so we can prove both are cleared on delete.
    store().then((s) => {
      const redux = s as { dispatch: (a: unknown) => void };
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(jobInList(s, JOB.job_id)).to.eq(true);
      });
      redux.dispatch({
        type: "jobs/setLayerStyle",
        payload: {
          jobId: JOB.job_id,
          style: { color: "#ff0000", opacity: 0.8 }
        }
      });
    });

    openChatAndSend();
    // delete_image_processing_job is not auto-approved: first the standard tool
    // approval modal, then the tool returns a destructive confirmation card.
    approveTool();
    // The confirmation card's Delete button can sit below the fold in the 40vh
    // widget — scroll it in and force-click.
    cy.contains("button", "Delete", { timeout: 15000 })
      .scrollIntoView()
      .click({ force: true });

    cy.wait("@deleteJob");
    store().then((s) => {
      const redux = s as {
        getState: () => {
          jobs: { selection: { layerStyles: Record<string, unknown> } };
        };
      };
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(jobInList(s, JOB.job_id), "job removed from list").to.eq(false);
        expect(
          redux.getState().jobs.selection.layerStyles[JOB.job_id],
          "layer style cleared"
        ).to.eq(undefined);
      });
    });
  });

  it("surfaces a failure and adds no job when submission fails", () => {
    interceptJobReads({ jobs: [] });
    cy.intercept("POST", "**/jobs", {
      statusCode: 500,
      body: { message: "model runner unavailable" }
    }).as("createJobFail");
    cy.intercept("POST", "**/latest/viewpoints", { statusCode: 500, body: {} });

    cy.mockBedrockToolCall("submit_image_processing_job", {
      job_name: "Doomed Job",
      image_url: "s3://my-bucket/scene.tif",
      model_endpoint_name: "aircraft-detector"
    });

    cy.visit("/map");
    cy.wait("@getModels");
    waitForAgentReady();

    openChatAndSend();
    approveTool();
    cy.wait("@createJobFail");

    store().then((s) => {
      const redux = s as {
        getState: () => { jobs: { jobsList: { jobs: unknown[] } } };
      };
      cy.wrap(null, { timeout: 10000 }).should(() => {
        expect(redux.getState().jobs.jobsList.jobs.length).to.eq(0);
      });
    });
  });

  it("reflects a restyle consistently across map and globe", () => {
    // A job's layer style lives in jobs.selection.layerStyles — the single
    // source of truth BOTH the map (useMapDetectionLayers) and globe
    // (useDetectionLayers) read. This proves cross-view consistency without
    // canvas-rendered detection geometry. Client-side nav keeps the in-memory
    // style (settings is the only persisted slice).
    interceptJobReads({ jobs: [JOB] });
    cy.visit("/map");
    cy.wait("@getModels");

    const newStyle = { color: "#1a2b3c", opacity: 0.42 };
    store().then((s) => {
      const redux = s as { dispatch: (a: unknown) => void };
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(jobInList(s, JOB.job_id)).to.eq(true);
      });
      redux.dispatch({
        type: "jobs/setLayerStyle",
        payload: { jobId: JOB.job_id, style: newStyle }
      });
    });

    // Map sees the new style.
    getState()
      .its(`jobs.selection.layerStyles.${JOB.job_id}`)
      .should("deep.equal", newStyle);

    // The same style is present after navigating to the globe.
    navigateViaHome("/globe");
    cy.window().its("__OSML_STORE__", { timeout: 15000 }).should("exist");
    getState()
      .its(`jobs.selection.layerStyles.${JOB.job_id}`)
      .should("deep.equal", newStyle);
  });
});

export {};
