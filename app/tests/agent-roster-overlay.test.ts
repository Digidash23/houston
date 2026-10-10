import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  overlayAgentRoster,
  paintAgentRow,
  restoreAgentRow,
  selectionAfterRefusedDelete,
} from "../src/lib/agent-roster-overlay.ts";
import type { Agent } from "../src/lib/types.ts";

const agent = (id: string, name = id, color = "blue"): Agent => ({
  id,
  name,
  color,
  folderPath: `/ws/${id}`,
  configId: "default",
  createdAt: "2026-10-08T00:00:00Z",
});
const roster = () => [agent("a"), agent("b"), agent("c")];
const none = { deletes: new Set<string>(), paints: [] };

describe("overlayAgentRoster", () => {
  it("returns the same roster when nothing is held", () => {
    const agents = roster();
    assert.equal(overlayAgentRoster(agents, none), agents);
  });

  it("hides an agent whose delete is in flight", () => {
    const next = overlayAgentRoster(roster(), {
      deletes: new Set(["b"]),
      paints: [],
    });
    assert.deepEqual(
      next.map((a) => a.id),
      ["a", "c"],
    );
  });

  it("paints held renames and recolors over a fresh read, in order", () => {
    const next = overlayAgentRoster(roster(), {
      deletes: new Set(),
      paints: [
        { id: "a", paint: { name: "Ada" } },
        { id: "a", paint: { color: "red" } },
        { id: "zz", paint: { name: "ghost" } },
      ],
    });
    assert.equal(next[0]?.name, "Ada");
    assert.equal(next[0]?.color, "red");
    assert.deepEqual(next[1], agent("b"), "an agent with no hold is untouched");
  });

  it("is idempotent: a painted roster comes back as the same array", () => {
    const holds = {
      deletes: new Set(["c"]),
      paints: [{ id: "a", paint: { name: "Ada" } }],
    };
    const once = overlayAgentRoster(roster(), holds);
    assert.equal(overlayAgentRoster(once, holds), once);
  });
});

describe("paintAgentRow", () => {
  it("keeps the same object when the paint matches", () => {
    const a = agent("a", "Ada", "red");
    assert.equal(paintAgentRow(a, { name: "Ada", color: "red" }), a);
    assert.equal(paintAgentRow(a, {}), a);
  });
});

describe("restoreAgentRow", () => {
  it("puts a refused delete back where it was", () => {
    const row = agent("b");
    const next = restoreAgentRow([agent("a"), agent("c")], row, 1);
    assert.deepEqual(
      next.map((a) => a.id),
      ["a", "b", "c"],
    );
  });

  it("does not duplicate a row a reload already brought back", () => {
    const agents = roster();
    assert.equal(restoreAgentRow(agents, agent("b"), 1), agents);
  });

  it("clamps an index the roster has shrunk past", () => {
    const next = restoreAgentRow([agent("a")], agent("z"), 9);
    assert.deepEqual(
      next.map((a) => a.id),
      ["a", "z"],
    );
  });
});

describe("selectionAfterRefusedDelete", () => {
  it("returns the view to the agent whose delete was refused", () => {
    const [a, b] = roster();
    assert.equal(selectionAfterRefusedDelete(b, b, a), a);
  });

  it("returns it when the delete left no agent to switch to", () => {
    const [a] = roster();
    assert.equal(selectionAfterRefusedDelete(null, null, a), a);
  });

  it("keeps a pick the person made while the delete was in flight", () => {
    const [a, b, c] = roster();
    assert.equal(selectionAfterRefusedDelete(c, b, a), null);
    assert.equal(selectionAfterRefusedDelete(c, null, a), null);
  });
});
