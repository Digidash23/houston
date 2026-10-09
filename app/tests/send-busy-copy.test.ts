import { strictEqual } from "node:assert";
import { describe, it } from "node:test";
import en from "../src/locales/en/chat.json" with { type: "json" };
import es from "../src/locales/es/chat.json" with { type: "json" };
import pt from "../src/locales/pt/chat.json" with { type: "json" };

// A send held behind a running turn past its whole budget settles with the
// typed `notice: "send_busy"`, and the app renders `chat:sendBusy` by kind.
describe("send-busy chat copy", () => {
  it("is authored in every shipped language", () => {
    strictEqual(typeof en.sendBusy, "string");
    strictEqual(en.sendBusy === "", false);
    for (const bundle of [es, pt]) {
      strictEqual(typeof bundle.sendBusy, "string");
      strictEqual(bundle.sendBusy === en.sendBusy, false);
    }
  });

  // A send the cloud's shared compute had no room for: `chat:sendWaitingBusy`
  // replaces the thinking line while the SDK re-sends it
  // (`ConversationVM.sendWaiting`), and `chat:computeBusy` renders the
  // `compute_busy` notice once it runs out of time.
  it("authors the busy-compute lines in every shipped language", () => {
    for (const key of ["computeBusy", "sendWaitingBusy"] as const) {
      strictEqual(typeof en[key], "string");
      strictEqual(en[key] === "", false);
      strictEqual(en[key].includes("\u2014"), false);
      for (const bundle of [es, pt]) {
        strictEqual(typeof bundle[key], "string");
        strictEqual(bundle[key] === en[key], false);
      }
    }
  });

  // A turn that failed before it could start settles with the typed
  // `agent_too_large` / `agent_setup_failed` notice (H-003), rendered by kind.
  it("authors the setup-failure lines in every shipped language", () => {
    for (const key of ["tooLarge", "failed"] as const) {
      strictEqual(typeof en.agentSetup[key], "string");
      strictEqual(en.agentSetup[key] === "", false);
      for (const bundle of [en, es, pt])
        strictEqual(bundle.agentSetup[key].includes("\u2014"), false);
      for (const bundle of [es, pt]) {
        strictEqual(typeof bundle.agentSetup[key], "string");
        strictEqual(bundle.agentSetup[key] === en.agentSetup[key], false);
      }
    }
  });
});
