import { expect, test } from "vitest";
import { importScope } from "./op-scope";
import { importListed, opClaimId, opTreeOptions } from "./op-tree-options";

const RUNTIME = "workspaces/Personal/Bob/.houston/runtime";

test("an import lists the runtime transcripts and sessions, nothing else of the runtime tree", () => {
  for (const rel of [
    `${RUNTIME}/conversations/c1.json`,
    `${RUNTIME}/conversations/c1.archive/1.json`,
    `${RUNTIME}/sessions/c1/s.jsonl`,
    "workspaces/Personal/Bob/CLAUDE.md",
    "workspaces/Personal/Bob/files/.houston/runtime/mine.txt",
    "custom-integrations.json",
  ])
    expect(importListed(rel), rel).toBe(true);
  for (const rel of [
    `${RUNTIME}/settings.json`,
    `${RUNTIME}/runtime.log`,
    `${RUNTIME}/models-store/x.json`,
    `${RUNTIME}/conversations`,
  ])
    expect(importListed(rel), rel).toBe(false);
});

test("an import writes the agent tree, transcripts with their segments, and sessions", () => {
  const include = importScope("workspaces/Personal/Bob", RUNTIME);
  for (const rel of [
    "workspaces/Personal/Bob/notes.md",
    `${RUNTIME}/conversations/c1.json`,
    `${RUNTIME}/conversations/c1.archive/2.json`,
    `${RUNTIME}/sessions/c1/2026.jsonl`,
  ])
    expect(include(rel), rel).toBe(true);
  for (const rel of [
    `${RUNTIME}/settings.json`,
    `${RUNTIME}/auth.json`,
    `${RUNTIME}/conversations/c1.txt`,
    `${RUNTIME}/conversations/c1.archive/deep/2.json`,
    "workspaces/Personal/Ann/notes.md",
  ])
    expect(include(rel), rel).toBe(false);
});

test("only a migration import takes the agent-import claim", () => {
  const route = (rest: string) =>
    ({ kind: "route", method: "POST", rest }) as const;
  expect(opClaimId(route("migration/import"))).toBe("agent-import");
  expect(opClaimId(route("migration%2Fimport"))).toBe("agent-import");
  expect(opClaimId(route("migration/complete"))).toBe("agent-ops");
  expect(opClaimId(route("routines"))).toBe("agent-ops");
  expect(
    opClaimId({ kind: "conversation", action: "delete", conversationId: "c1" }),
  ).toBe("c1");
  expect(opTreeOptions(route("routines")).excludes).toEqual([
    "workspaces/*/*/.houston/runtime/",
  ]);
  expect(opTreeOptions(route("migration/import")).excludes).toBeUndefined();
});
