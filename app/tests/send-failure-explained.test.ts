import { strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { UploadInterruptedError } from "@houston/sdk/files/upload-interrupted";
import { sendFailureAlreadyExplained } from "../src/lib/send-failure-explained.ts";

// HOUSTON-APP-5CG follow-up: the generic "couldn't send" toast is skipped only
// when the toast already shown says the send failed.
describe("sendFailureAlreadyExplained", () => {
  it("skips the repeat for an interrupted upload", () => {
    strictEqual(
      sendFailureAlreadyExplained(
        new UploadInterruptedError("attachments", 1, 60_000, "Failed to fetch"),
      ),
      true,
    );
  });

  // The waking toast says "you don't need to send your message again", and a
  // sustained drop can gate the offline toast away: a send that never reached
  // the conversation must still say it failed.
  it("keeps the send-failed toast for waking, offline and a real bug", () => {
    const waking = Object.assign(
      new Error("engine unavailable (engine error 503)"),
      { name: "HoustonEngineError", status: 503 },
    );
    strictEqual(sendFailureAlreadyExplained(waking), false);
    strictEqual(
      sendFailureAlreadyExplained(new TypeError("Load failed")),
      false,
    );
    strictEqual(
      sendFailureAlreadyExplained(new TypeError("x is not a function")),
      false,
    );
  });
});
