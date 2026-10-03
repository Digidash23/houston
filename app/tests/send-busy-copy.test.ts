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
});
