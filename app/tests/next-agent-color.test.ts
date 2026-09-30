import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENT_COLORS } from "@houston-ai/core";
import {
  AGENT_COLOR_SPREAD,
  nextFreeAgentColor,
} from "../src/lib/next-agent-color.ts";

const ids = [...AGENT_COLOR_SPREAD];

describe("nextFreeAgentColor", () => {
  it("starts the palette for the first hire", () => {
    assert.deepEqual(ids, [
      "navy",
      "rose",
      "golden",
      "forest",
      "purple",
      "orange",
      "teal",
      "crimson",
      "umber",
      "charcoal",
    ]);
    assert.deepEqual(new Set(ids), new Set(AGENT_COLORS.map((c) => c.id)));
    assert.equal(nextFreeAgentColor([]), "navy");
  });

  it("skips colors a teammate already wears, by id or by hex", () => {
    assert.equal(nextFreeAgentColor([ids[0]]), ids[1]);
    assert.equal(
      nextFreeAgentColor([
        AGENT_COLORS.find((c) => c.id === ids[0])?.light,
        AGENT_COLORS.find((c) => c.id === ids[1])?.dark,
      ]),
      ids[2],
    );
  });

  it("ignores colors outside the palette and missing ones", () => {
    assert.equal(nextFreeAgentColor(["#123456", undefined]), ids[0]);
  });

  it("reuses the least worn color once every one is taken", () => {
    const everyOnce = [...ids];
    assert.equal(nextFreeAgentColor(everyOnce), ids[0]);
    assert.equal(nextFreeAgentColor([...everyOnce, ids[0]]), ids[1]);
  });

  it("keeps the spread order when colors have equal wear", () => {
    const dealt: string[] = [];
    for (const expected of ids) {
      const next = nextFreeAgentColor(dealt);
      assert.equal(next, expected);
      dealt.push(next);
    }
  });
});
