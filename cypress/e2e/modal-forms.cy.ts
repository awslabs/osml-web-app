// Copyright Amazon.com, Inc. or its affiliates.
/**
 * The two large human-facing modal forms: create-image-job and create-viewpoint.
 * Job submission is also covered via the agent tool (jobs.cy.ts); here we cover
 * the FORM mechanics a human uses — field entry, the embedded S3 selector,
 * submit-gating, and that submit drives the same backend calls.
 */

const ENDPOINTS = {
  endpoints: [
    { name: "aircraft-detector", status: "InService" },
    { name: "vehicle-detector", status: "InService" }
  ]
};
const BUCKETS = { buckets: [{ name: "imagery-bucket" }] };
const OBJECTS = { objects: [{ key: "scenes/airport.tif" }] };

// Mock everything the modals fan out to: SageMaker endpoints, S3 buckets +
// objects, and the job/viewpoint create + list endpoints.
function interceptModalDeps() {
  cy.intercept("GET", "**/sagemaker/endpoints", {
    statusCode: 200,
    body: ENDPOINTS
  }).as("getEndpoints");
  cy.intercept("GET", "**/s3/buckets", { statusCode: 200, body: BUCKETS }).as(
    "getBuckets"
  );
  cy.intercept("GET", "**/s3/buckets/*/objects", {
    statusCode: 200,
    body: OBJECTS
  }).as("getObjects");
  cy.intercept("POST", "**/jobs", {
    statusCode: 200,
    body: { job_id: "modal-job-1", status: "SUCCESS" }
  }).as("createJob");
  // Empty jobs list: keeps the sidebar/state clean so the only thing under test
  // is the modal form itself (a populated list isn't relevant here).
  cy.intercept("GET", "**/jobs", { statusCode: 200, body: { jobs: [] } });
  cy.intercept("POST", "**/latest/viewpoints", {
    statusCode: 201,
    body: { viewpoint_id: "modal-vp-1" }
  }).as("createViewpoint");
  cy.intercept("GET", "**/latest/viewpoints", {
    statusCode: 200,
    body: { items: [] }
  });
  cy.intercept("GET", "**/latest/viewpoints/*/image/**", {
    statusCode: 200,
    body: {}
  });
}

// The open modal's dialog root, scoped by its header text. The sidebar drawer
// is also role="dialog" (and holds its own "Create Job" trigger); cy.contains
// returns the narrowest match (the header), so walk back up to the dialog root.
function dialog(headerText: string) {
  return cy
    .contains('[role="dialog"]', headerText, { timeout: 15000 })
    .closest('[role="dialog"]');
}

// HeroUI Input associates its visible <label> with the <input> via htmlFor/id.
// The labels here are unique to the open modal, so match globally.
function fieldByLabel(label: string) {
  return cy
    .contains("label", label, { timeout: 15000 })
    .invoke("attr", "for")
    .then((id) => cy.get(`#${id}`));
}

// The modal's Create submit button (not the sidebar trigger).
function createButton(header: string) {
  return dialog(header).contains("button", "Create");
}

// The S3 selector renders native <select>s (HeroUI Select w/ onChange). Target
// each by the <option> value it contains rather than a DOM index (the job modal
// has other selects too). HeroUI's native <select> is visually hidden
// (tabindex=-1), so force past Cypress's actionability check. The option may
// load asynchronously (e.g. objects after a bucket is chosen), so wait for it.
function selectByOption(optionValue: string) {
  const sel = `select:has(option[value="${CSS.escape(optionValue)}"])`;
  cy.get(sel, { timeout: 15000 }).should("exist");
  return cy.get(sel).first().select(optionValue, { force: true });
}

describe("Modal forms", () => {
  beforeEach(() => {
    cy.loginBypass();
    cy.mockBedrockModels();
    interceptModalDeps();
  });

  describe("Create image job", () => {
    const HEADER = "Create Image Processing Job";
    function openCreateJob() {
      cy.visit("/map");
      cy.wait("@getModels");
      cy.get('[aria-label="Menu"]').click();
      cy.get('[aria-label="Image Processing Jobs"]', {
        timeout: 15000
      }).click();
      cy.get('[aria-label="Create new job"]', { timeout: 15000 }).click();
      cy.contains(HEADER, { timeout: 10000 }).should("exist");
      cy.wait("@getEndpoints");
    }

    it("keeps Create disabled until required fields are filled", () => {
      openCreateJob();
      // Job name + selected image + endpoint are all required; none yet.
      createButton(HEADER).should("be.disabled");
    });

    it("submits a job from the filled form", () => {
      openCreateJob();

      fieldByLabel("Job Name").type("Modal Job");

      // Pick the bucket; selectByOption waits for the object <option> to appear
      // (it loads after the bucket is chosen) before selecting it.
      cy.wait("@getBuckets");
      selectByOption("imagery-bucket");
      selectByOption("scenes/airport.tif");

      // Endpoint auto-selects the first → all required fields satisfied.
      createButton(HEADER).should("not.be.disabled").click();

      cy.wait("@createJob")
        .its("request.body")
        .should((body) => {
          const s = JSON.stringify(body);
          expect(s).to.contain("Modal Job");
          expect(s).to.contain("imagery-bucket");
          expect(s).to.contain("aircraft-detector");
        });
    });
  });

  describe("Create viewpoint", () => {
    const HEADER = "Create New Viewpoint";
    function openCreateViewpoint() {
      cy.visit("/image");
      cy.wait("@getModels");
      cy.get('[aria-label="Menu"]').click();
      cy.get('[aria-label="Create new viewpoint"]', { timeout: 15000 }).click();
      cy.contains(HEADER, { timeout: 10000 }).should("exist");
    }

    it("keeps Create disabled until required fields are filled", () => {
      openCreateViewpoint();
      createButton(HEADER).should("be.disabled");
    });

    it("submits a viewpoint from the filled form", () => {
      openCreateViewpoint();

      fieldByLabel("Viewpoint Name").type("Modal Viewpoint");
      fieldByLabel("Viewpoint ID").type("modal-vp-1");

      cy.wait("@getBuckets");
      selectByOption("imagery-bucket");
      selectByOption("scenes/airport.tif");

      createButton(HEADER).should("not.be.disabled").click();

      cy.wait("@createViewpoint")
        .its("request.body")
        .should((body) => {
          expect(JSON.stringify(body)).to.contain("modal-vp-1");
        });
    });
  });
});

export {};
