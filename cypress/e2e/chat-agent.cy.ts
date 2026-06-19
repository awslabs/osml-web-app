// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Geospatial agent chat UI: the model selector, and the render / send / receive
 * mechanics of the conversation. Per the agreed scope we do NOT test whether the
 * LLM picks the right tool — only that the chat surface behaves. (Tool execution
 * lives in tool-execution.cy.ts.)
 */
import { sendInFullChat, store, waitForAgentReady } from "../support/helpers";

interface ChatMsg {
  type: string;
  content: string;
}

const READY_INPUT =
  'input[placeholder="Ask about geospatial data, coordinates, maps..."]';

describe("Chat agent", () => {
  beforeEach(() => {
    cy.loginBypass();
    cy.mockBedrockModels();
  });

  describe("Model selector", () => {
    beforeEach(() => {
      cy.visit("/geo-agent");
      cy.wait("@getModels");
      // The selector is in the AI Model accordion inside the left drawer.
      cy.get('[aria-label="Menu"]').click();
    });

    // HeroUI Select renders a hidden <label aria-label> plus a button trigger
    // (aria-haspopup="listbox"). Target the trigger button, not the label.
    const modelTrigger = () =>
      cy.get('button[aria-label="Select AI Model"][aria-haspopup="listbox"]');

    it("displays the auto-selected model", () => {
      // The preferred/first model auto-selects on load; the trigger reflects it.
      // Proves the selector mounted and is wired to the models list, without
      // depending on opening the (flaky) React-Aria listbox portal.
      modelTrigger().should("be.visible").and("contain", "Claude Sonnet 4.5");
    });

    // Picking a model from the open listbox is not asserted: the HeroUI/
    // React-Aria Select portal opens then collapses on requery headless, so the
    // tests verify the selector mounts and auto-selects rather than manual picks.

    it("shows the refresh button", () => {
      cy.get('[aria-label="Refresh models"]').should("be.visible");
    });

    it("refreshes the model list on demand", () => {
      cy.get('[aria-label="Refresh models"]').click();
      cy.wait("@getModels");
    });
  });

  describe("Conversation", () => {
    beforeEach(() => {
      cy.visit("/geo-agent");
      cy.wait("@getModels");
      waitForAgentReady();
    });

    it("renders the chat input and Send control", () => {
      cy.get(READY_INPUT, { timeout: 20000 }).should("be.visible");
      cy.get('button[type="submit"]').contains("Send").should("exist");
    });

    it("renders the user message and the AI reply in the transcript", () => {
      cy.mockBedrockText("Hello from the test agent.");
      sendInFullChat("hello agent");

      cy.contains("hello agent", { timeout: 15000 }).should("be.visible");
      cy.contains("Hello from the test agent.", { timeout: 15000 }).should(
        "be.visible"
      );
    });

    it("accumulates multi-turn history in chat-session state", () => {
      cy.mockBedrockText("reply one");
      sendInFullChat("first question");
      cy.contains("reply one", { timeout: 15000 }).should("be.visible");
      sendInFullChat("second question");

      store().then((s) => {
        const redux = s as {
          getState: () => { chatSession: { history: ChatMsg[] } };
        };
        cy.wrap(null, { timeout: 15000 }).should(() => {
          const history = redux.getState().chatSession.history;
          expect(
            history.some((m) => m.content.includes("first question"))
          ).to.eq(true);
          expect(
            history.some((m) => m.content.includes("second question"))
          ).to.eq(true);
        });
      });
    });

    it("clears the transcript with Clear History", () => {
      cy.mockBedrockText("a reply to clear");
      sendInFullChat("something to clear");
      cy.contains("a reply to clear", { timeout: 15000 }).should("be.visible");

      cy.contains("button", "Clear History").click();

      store().then((s) => {
        const redux = s as {
          getState: () => { chatSession: { history: ChatMsg[] } };
        };
        cy.wrap(null, { timeout: 10000 }).should(() => {
          const history = redux.getState().chatSession.history;
          expect(
            history.some((m) => m.content.includes("something to clear")),
            "user message cleared"
          ).to.eq(false);
        });
      });
    });
  });

  describe("Resilience", () => {
    beforeEach(() => {
      cy.visit("/geo-agent");
      cy.wait("@getModels");
      waitForAgentReady();
    });

    it("shows a Stop button while a reply is in flight", () => {
      // Delay the chat response so the in-flight (isRunning) state persists.
      cy.intercept("POST", "**/bedrock/chat", (req) => {
        req.reply({
          delay: 8000,
          statusCode: 200,
          body: { message: "late reply", usage: {} }
        });
      }).as("slowChat");

      cy.get(READY_INPUT).type("take your time");
      cy.get('button[type="submit"]').contains("Send").click();

      // While the request is outstanding, the Stop control appears...
      cy.contains("button", "Stop", { timeout: 10000 }).should("be.visible");
      // ...and clicking it cancels generation (Stop goes away).
      cy.contains("button", "Stop").click();
      cy.contains("button", "Stop").should("not.exist");
    });

    it("disables input while throttled and re-enables when cleared", () => {
      // Throttle the active model directly, then assert the input + countdown.
      store().then((s) => {
        const redux = s as {
          getState: () => {
            bedrockModel: { selectedModel: { modelId: string } };
          };
          dispatch: (a: unknown) => void;
        };
        const modelId = redux.getState().bedrockModel.selectedModel.modelId;
        cy.wrap(modelId).as("modelId");
        redux.dispatch({
          type: "bedrockThrottle/setThrottled",
          payload: {
            modelId,
            errorType: "rate_limit",
            message: "Rate limited",
            retryAfterSeconds: 60,
            timestamp: new Date(0).toISOString()
          }
        });
      });

      // Input is disabled and a retry countdown is shown.
      cy.get(READY_INPUT).should("be.disabled");
      cy.contains("Retry in", { timeout: 10000 }).should("exist");

      // Clearing the throttle re-enables the input. The aliased value is a
      // string id; Cypress's .then() types it as `any`, so narrow it explicitly.
      cy.get("@modelId").then((aliased) => {
        const modelId = aliased as unknown as string;
        store().invoke("dispatch", {
          type: "bedrockThrottle/clearThrottle",
          payload: modelId
        });
      });
      cy.get(READY_INPUT).should("not.be.disabled");
    });
  });
});

export {};
