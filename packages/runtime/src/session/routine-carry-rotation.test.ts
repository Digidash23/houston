import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WireEvent } from "@houston/runtime-client";
import { beforeEach, expect, test, vi } from "vitest";
import type { HarnessSession, ResolvedModel } from "../backends/types";

/**
 * The routine budget must not depend on what survived a transcript rotation.
 * A run whose own messages outgrow the live file's budget stays live whole
 * (the newest turn is never split), and the NEXT run's user row then rotates
 * that whole run into an archive segment: the live file holds nothing but the
 * current user row. Read from the live file alone, the previous run's carry
 * was gone and the standing server resumed a session far past its window,
 * while a pooled worker (reading before its own append) still saw it.
 */

process.env.HOUSTON_DATA_DIR = mkdtempSync(join(tmpdir(), "houston-rcarry-"));
process.env.HOUSTON_WORKSPACE_DIR = process.env.HOUSTON_DATA_DIR;

const { registerBackend } = await import("../backends/registry");
const { recordRoutineCarry, resetRoutineSessionIfNeeded } = await import(
  "./routine-session-reset"
);
const { resetPooledRoutineContext } = await import(
  "../turn/turn-routine-context"
);
const { appendAssistantMessage, appendUserMessage, getRoutineTranscript } =
  await import("../store/conversations");
const { config } = await import("../config");
type Conversation = import("./conversation-record").Conversation;

const MODEL: ResolvedModel = {
  provider: "carry",
  id: "carry-1",
  contextWindow: 200_000,
};

function session(): HarnessSession {
  return {
    subscribe: (_l: (e: WireEvent) => void) => () => {},
    prompt: async () => {},
    abort: async () => {},
    dispose: () => {},
    setModel: async () => {},
    compact: async () => undefined,
    setThinkingLevel: () => {},
    getContextUsage: () => undefined,
  };
}
registerBackend("carry", { id: "carry", createSession: async () => session() });

const conv = (): Conversation => ({
  session: session(),
  queue: Promise.resolve(),
  provider: "carry",
  model: "carry-1",
  backendId: "carry",
  mode: "auto",
  pending: 1,
});

/** One finished run whose reply alone is past the live file's budget. */
function hugeRun(id: string, usage: boolean): void {
  appendUserMessage(id, "Export everything.", { turnId: "big" });
  appendAssistantMessage(id, `Export: ${"row;".repeat(2_300_000)}`, {
    turnId: "big",
    ...(usage
      ? {
          usage: {
            context_tokens: 150_000,
            output_tokens: 2_000,
            cached_tokens: 0,
          },
        }
      : {}),
  });
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
});

test("the next run resets on both paths even when rotation archived the whole previous run", async () => {
  const id = "routine-rotated-carry";
  hugeRun(id, true);
  recordRoutineCarry(id, "big", null);
  appendUserMessage(id, "Export everything.", { turnId: "now" });
  // The rotation left the live file holding only this run's own user row.
  expect(getRoutineTranscript(id)).toMatchObject({
    messages: [{ turnId: "now" }],
    rotated: true,
  });

  const standing = await resetRoutineSessionIfNeeded(
    conv(),
    id,
    "now",
    "Export everything.",
    MODEL,
    "auto",
  );
  const pooled = resetPooledRoutineContext({
    dataDir: config.dataDir,
    conversationId: id,
    turnId: "now",
    windowTokens: 200_000,
  });

  expect(standing?.preTokens).toBe(152_000);
  expect(pooled?.compaction.pre_tokens).toBe(152_000);
  // The fresh session still remembers the archived run, clipped to budget.
  expect(standing?.replay?.text).toContain("row;row;");
});

test("a rotated chat with no recorded carry resets on both paths rather than guess", async () => {
  const id = "routine-rotated-legacy";
  hugeRun(id, false);
  appendUserMessage(id, "Export everything.", { turnId: "now" });

  const standing = await resetRoutineSessionIfNeeded(
    conv(),
    id,
    "now",
    "Export everything.",
    MODEL,
    "auto",
  );
  const pooled = resetPooledRoutineContext({
    dataDir: config.dataDir,
    conversationId: id,
    turnId: "now",
    windowTokens: 200_000,
  });
  expect(standing).not.toBeNull();
  expect(pooled).not.toBeNull();
});
