import assert from "node:assert/strict";
import test from "node:test";
import { fallbackMissionTitle } from "./mission-title-text.ts";

test("fallback mission title trims long text on word boundary", () => {
  assert.equal(
    fallbackMissionTitle(
      "Please write a long investor update for the whole team",
    ),
    "Please write a long investor update for...",
  );
});

test("fallback mission title handles empty text", () => {
  assert.equal(fallbackMissionTitle("   \n\t"), "New mission");
});
