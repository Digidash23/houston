import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { useManagerHandoffStore } from "../src/stores/manager-handoff.ts";

describe("the manager handoff", () => {
  it("is taken exactly once", () => {
    const handoff = {
      prompt: "Hidden kickoff to start the goal.",
      grants: ["createAgent"] as ["createAgent"],
    };
    useManagerHandoffStore.getState().handOff(handoff);
    deepStrictEqual(useManagerHandoffStore.getState().take(), handoff);
    strictEqual(useManagerHandoffStore.getState().take(), null);
  });

  it("has nothing to take before a handoff", () => {
    strictEqual(useManagerHandoffStore.getState().take(), null);
  });
});
