import { strictEqual } from "node:assert";
import { it } from "node:test";
import { isTypedSend } from "../src/lib/sent-for-person.ts";

it("counts only what the person typed as their chat message", () => {
  strictEqual(isTypedSend({}), true);
  strictEqual(isTypedSend({ sentForPerson: true }), false);
});
