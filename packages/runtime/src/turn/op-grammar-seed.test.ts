import { expect, test } from "vitest";
import { parseOpRequest } from "./parse-op-request";

const envelope = (op: unknown) => ({
  workspaceId: "w1",
  agentId: "a1",
  gcsPrefix: "ws/w1/a1",
  hostToken: "ht",
  claim: { id: "c", bootId: "b", token: "t", heartbeatUrl: "http://x/hb" },
  op,
});

test("a seed op parses its trimmed name, CLAUDE.md and seed map", () => {
  const parsed = parseOpRequest(
    envelope({
      kind: "seed",
      name: "  Ledger ",
      claudeMd: "# Ledger\n",
      seeds: { "notes.json": "[]" },
    }),
  );
  expect(parsed.op).toEqual({
    kind: "seed",
    name: "Ledger",
    claudeMd: "# Ledger\n",
    seeds: { "notes.json": "[]" },
  });
  expect(parseOpRequest(envelope({ kind: "seed", name: "Bare" })).op).toEqual({
    kind: "seed",
    name: "Bare",
  });
});

test("a seed op without a usable name is refused with the domain's message", () => {
  expect(() => parseOpRequest(envelope({ kind: "seed" }))).toThrow(
    "invalid 'op.name'",
  );
  expect(() => parseOpRequest(envelope({ kind: "seed", name: "a/b" }))).toThrow(
    "agent name must not contain slashes, control characters, '..', or a leading dot",
  );
  expect(() => parseOpRequest(envelope({ kind: "seed", name: "   " }))).toThrow(
    "agent name must not be empty",
  );
});

test("a seed op's payload must be a string CLAUDE.md and a safe string map", () => {
  const seed = (extra: object) =>
    parseOpRequest(envelope({ kind: "seed", name: "Ledger", ...extra }));
  expect(() => seed({ claudeMd: 3 })).toThrow("invalid 'op.claudeMd'");
  expect(() => seed({ seeds: ["a"] })).toThrow("invalid 'op.seeds'");
  expect(() => seed({ seeds: { "a.md": 1 } })).toThrow("invalid 'op.seeds'");
  expect(() => seed({ seeds: { "../evil": "x" } })).toThrow(
    "unsafe seed path: ../evil",
  );
});
