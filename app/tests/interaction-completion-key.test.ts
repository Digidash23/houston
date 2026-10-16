import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interactionCompletionKey } from "../src/lib/interaction-completion-key.ts";

describe("interactionCompletionKey", () => {
  it("separates two agents asking the same question in same-named conversations", () => {
    assert.notEqual(
      interactionCompletionKey("alpha", "activity-1", "q"),
      interactionCompletionKey("beta", "activity-1", "q"),
    );
  });

  it("is stable for the same card", () => {
    assert.equal(
      interactionCompletionKey("alpha", "activity-1", "q"),
      '["alpha","activity-1","q"]',
    );
  });

  it("cannot be forged by a separator inside a part", () => {
    assert.notEqual(
      interactionCompletionKey("a:b", "c", "q"),
      interactionCompletionKey("a", "b:c", "q"),
    );
  });
});
