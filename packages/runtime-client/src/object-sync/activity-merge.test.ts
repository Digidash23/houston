import { describe, expect, test } from "vitest";
import { mergeActivityArrays } from "./activity-merge";
import { mergeDocumentBodies } from "./sync-back-doc-merge";

const DOC = "workspaces/W/A/.houston/activity/activity.json";

const card = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  title: `Card ${id}`,
  status: "running",
  updated_at: "2026-09-28T10:00:00.000Z",
  ...fields,
});

const merge = (
  remote: unknown[],
  local: unknown[],
  base?: unknown[],
): unknown[] =>
  JSON.parse(
    mergeDocumentBodies(
      DOC,
      JSON.stringify(local),
      JSON.stringify(remote),
      base === undefined ? undefined : JSON.stringify(base),
    ) ?? "null",
  ) as unknown[];

describe("three-way activity merge", () => {
  const base = [card("a"), card("b")];

  test("a card the gateway created mid-turn survives the turn's upload", () => {
    const local = [card("a", { status: "needs_you" }), card("b")];
    const remote = [...base, card("g", { title: "From the gateway" })];
    expect(merge(remote, local, base)).toEqual([
      card("a", { status: "needs_you" }),
      card("b"),
      card("g", { title: "From the gateway" }),
    ]);
  });

  test("remote wins a field both sides changed; other fields combine", () => {
    const local = [
      card("a", { status: "needs_you", title: "Turn" }),
      card("b"),
    ];
    const remote = [card("a", { status: "done" }), card("b")];
    expect(merge(remote, local, base)).toEqual([
      card("a", { status: "done", title: "Turn" }),
      card("b"),
    ]);
  });

  test("a card deleted remotely is not resurrected, even if the turn edited it", () => {
    const local = [card("a", { status: "needs_you" }), card("b")];
    const remote = [card("b")];
    expect(merge(remote, local, base)).toEqual([card("b")]);
  });

  test("a card the turn deleted stays deleted unless the remote changed it", () => {
    expect(merge(base, [card("b")], base)).toEqual([card("b")]);
    const remote = [card("a", { status: "done" }), card("b")];
    expect(merge(remote, [card("b")], base)).toEqual([
      card("a", { status: "done" }),
      card("b"),
    ]);
  });

  test("a turn-only change and a turn-created card land untouched", () => {
    const local = [card("a", { description: "new" }), card("b"), card("t")];
    expect(merge(base, local, base)).toEqual([
      card("a", { description: "new" }),
      card("b"),
      card("t"),
    ]);
  });

  test("a field one side removed is removed", () => {
    const withAgent = [card("a", { agent: "x" })];
    expect(mergeActivityArrays(withAgent, [card("a")], withAgent)).toEqual([
      card("a"),
    ]);
  });
});

describe("two-way activity merge (no base)", () => {
  test("keeps the union: gateway-created and turn-created cards both survive", () => {
    expect(merge([card("a"), card("g")], [card("a"), card("t")])).toEqual([
      card("a"),
      card("g"),
      card("t"),
    ]);
  });

  test("the newer updated_at wins a card both sides hold; a tie goes remote", () => {
    const later = { updated_at: "2026-09-28T11:00:00.000Z" };
    expect(
      merge(
        [card("a", { status: "done" })],
        [card("a", { ...later, status: "needs_you" })],
      ),
    ).toEqual([card("a", { ...later, status: "needs_you" })]);
    expect(
      merge(
        [card("a", { ...later, status: "done" })],
        [card("a", { status: "needs_you" })],
      ),
    ).toEqual([card("a", { ...later, status: "done" })]);
    expect(
      merge(
        [card("a", { status: "done" })],
        [card("a", { status: "needs_you" })],
      ),
    ).toEqual([card("a", { status: "done" })]);
  });

  test("an unparseable base degrades to the two-way merge", () => {
    const body = mergeDocumentBodies(
      DOC,
      JSON.stringify([card("t")]),
      JSON.stringify([card("g")]),
      "{not json",
    );
    expect(JSON.parse(body ?? "null")).toEqual([card("g"), card("t")]);
  });

  test("a non-array side refuses to merge", () => {
    expect(() => mergeDocumentBodies(DOC, "{}", "[]")).toThrow(/not an array/);
  });
});
