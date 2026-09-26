import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  nextUnrevealed,
  openingRevealed,
  revealFrames,
} from "../src/lib/manager-onboarding/reveal.ts";
import type { ScriptLine } from "../src/lib/manager-onboarding/script-types.ts";

const manager = (key: string): ScriptLine => ({
  kind: "manager",
  key,
  id: "welcome",
});
const receipt = (key: string): ScriptLine => ({
  kind: "receipt",
  key,
  question: "segment",
  value: "sales",
  editable: false,
});

describe("openingRevealed", () => {
  it("a fresh conversation says everything", () => {
    strictEqual(openingRevealed([manager("a"), manager("b")]).size, 0);
  });

  it("a reopened conversation shows its history and says the latest turn", () => {
    const lines = [manager("a"), receipt("r1"), manager("b"), manager("c")];
    deepStrictEqual([...openingRevealed(lines)], ["a"]);
  });
});

describe("nextUnrevealed", () => {
  it("skips the person's own answers and what was already said", () => {
    const lines = [manager("a"), receipt("r1"), manager("b")];
    strictEqual(nextUnrevealed(lines, new Set(["a"])), 2);
  });

  it("is -1 once everything is said", () => {
    strictEqual(nextUnrevealed([manager("a")], new Set(["a"])), -1);
  });
});

describe("revealFrames", () => {
  it("types a message out word by word, ending on the whole text", () => {
    deepStrictEqual(revealFrames("Hi there, friend."), [
      "Hi",
      "Hi there,",
      "Hi there, friend.",
    ]);
  });

  it("keeps the text exact, trailing spaces included", () => {
    strictEqual(revealFrames("Hi  ").at(-1), "Hi  ");
  });

  it("an empty message is one empty frame", () => {
    deepStrictEqual(revealFrames(""), [""]);
  });
});
