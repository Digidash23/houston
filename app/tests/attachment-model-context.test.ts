import { strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  buildAttachmentPrompt,
  joinModelContext,
} from "../src/lib/attachment-message.ts";

describe("joinModelContext", () => {
  it("keeps every present part, in order", () => {
    strictEqual(
      joinModelContext("The surface's pin.", "This send's instruction."),
      "The surface's pin.\n\nThis send's instruction.",
    );
  });

  it("is nothing when no part has anything", () => {
    strictEqual(joinModelContext(undefined, ""), undefined);
    strictEqual(joinModelContext(), undefined);
  });

  it("puts a send's instruction before the person's words", () => {
    strictEqual(
      buildAttachmentPrompt(
        "Yes, let's do it",
        [],
        [],
        joinModelContext(undefined, "Start the goal."),
      ),
      "Start the goal.\n\nYes, let's do it",
    );
  });
});
