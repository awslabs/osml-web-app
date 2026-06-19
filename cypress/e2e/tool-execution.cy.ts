// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tool-execution framework. Tools are scripted (we don't test LLM tool-choice);
 * we assert the execution PATH behaves: scripted tool_use → approval modal →
 * local handler → Redux effect.
 *
 *   - Approve runs the handler and its Redux effect lands
 *   - Deny aborts with no effect
 *   - draw_feature creates the agent-features overlay layer
 *   - set_analytics_display updates analytics state
 *
 * (The agent driving the shared viewport / globe camera is covered in
 * viewport.cy.ts; destructive-confirmation in data flows is covered by
 * jobs.cy.ts. Tool-limit warnings and per-tool auto-approve persistence are
 * follow-ups.)
 */
import {
  approveTool,
  openChatAndSend,
  sendInFullChat,
  store,
  waitForAgentReady
} from "../support/helpers";

const POLYGON =
  "POLYGON((-122.4 37.8, -122.3 37.8, -122.3 37.9, -122.4 37.9, -122.4 37.8))";

function agentFeatureLayerExists(s: unknown): boolean {
  const redux = s as {
    getState: () => { overlay: { layers: Record<string, unknown> } };
  };
  return Boolean(redux.getState().overlay.layers["agent-features"]);
}

describe("Tool execution", () => {
  beforeEach(() => {
    cy.loginBypass();
    cy.mockBedrockModels();
  });

  it("approving draw_feature creates the agent-features layer", () => {
    cy.mockBedrockToolCall("draw_feature", {
      wkt: POLYGON,
      description: "Cypress test polygon"
    });
    cy.visit("/geo-agent");
    cy.wait("@getModels");
    waitForAgentReady();

    sendInFullChat("draw a polygon");
    approveTool();

    store().then((s) => {
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(agentFeatureLayerExists(s), "agent-features layer added").to.eq(
          true
        );
      });
    });
  });

  it("denying draw_feature leaves overlay state untouched", () => {
    cy.mockBedrockToolCall("draw_feature", {
      wkt: POLYGON,
      description: "Should never be drawn"
    });
    cy.visit("/geo-agent");
    cy.wait("@getModels");
    waitForAgentReady();

    sendInFullChat("draw a polygon");
    cy.contains("button", "Deny", { timeout: 15000 })
      .should("be.visible")
      .click();

    store().then((s) => {
      cy.wrap(null, { timeout: 8000 }).should(() => {
        expect(
          agentFeatureLayerExists(s),
          "no agent-features layer after deny"
        ).to.eq(false);
      });
    });
  });

  it("set_analytics_display updates analytics state", () => {
    cy.mockBedrockToolCall("set_analytics_display", {
      color_mode: "confidence"
    });
    cy.visit("/map");
    cy.wait("@getModels");
    waitForAgentReady();

    openChatAndSend("color detections by confidence");
    approveTool();

    store().then((s) => {
      const redux = s as {
        getState: () => { analytics: { colorMode: string } };
      };
      cy.wrap(null, { timeout: 15000 }).should(() => {
        expect(redux.getState().analytics.colorMode).to.eq("confidence");
      });
    });
  });
});

export {};
