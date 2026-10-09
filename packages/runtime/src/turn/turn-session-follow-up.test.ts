import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WireEvent, WireFrame } from "@houston/runtime-client";
import { beforeEach, expect, test, vi } from "vitest";
import type { ForcedToolCall } from "../backends/forced-tool-call";
import type { HarnessBackend, HarnessSession } from "../backends/types";
import { recordSuggestActions } from "../session/interaction";
import { runTurn, type TurnDirectories } from "./turn-session";

/**
 * The per-turn worker runs the follow-up safety net between the prompt and
 * the outcome: a GPT reply that skipped `suggest_actions` still returns the
 * bubbles on the outcome the terminal `done` is built from, and the pass
 * itself puts nothing on the wire.
 */

vi.mock("./turn-runtime", () => ({
  createTurnModelRuntime: async () => ({
    modelRuntime: {},
    model: { provider: "openai-codex", id: "gpt-5.6-sol", contextWindow: 1 },
  }),
}));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

const ACTIONS = [
  { id: "a", label: "Otra", message: "Haz otra" },
  { id: "b", label: "Ajusta", message: "Ajústalo" },
];

function backend(calledInBand: boolean) {
  const wire = new Set<(e: WireEvent) => void>();
  const forceToolCall = vi.fn(
    async (): Promise<ForcedToolCall> => ({
      outcome: "called",
      args: { actions: ACTIONS },
    }),
  );
  const session = {
    subscribe(l: (e: WireEvent) => void) {
      wire.add(l);
      return () => wire.delete(l);
    },
    async prompt() {
      for (const l of wire) l({ type: "text", data: "Listo." });
      if (calledInBand) recordSuggestActions({ actions: ACTIONS });
    },
    forceToolCall,
    abort: async () => undefined,
    dispose: () => undefined,
    setModel: async () => undefined,
    compact: async () => undefined,
    setThinkingLevel: () => undefined,
    getContextUsage: () => undefined,
  } as HarnessSession;
  const created: HarnessBackend = {
    id: "pi",
    createSession: async () => session,
  };
  return { created, forceToolCall };
}

async function run(calledInBand: boolean) {
  const turnRoot = await mkdtemp(join(tmpdir(), "turn-fu-"));
  const dirs: TurnDirectories = {
    turnRoot,
    workspaceDir: join(turnRoot, "store", "workspace"),
    dataDir: join(turnRoot, "store", "data"),
  };
  await mkdir(dirs.workspaceDir, { recursive: true });
  await mkdir(dirs.dataDir, { recursive: true });
  const frames: WireFrame[] = [];
  const { created, forceToolCall } = backend(calledInBand);
  const outcome = await runTurn(
    dirs,
    {
      conversationId: "activity-c1",
      text: "hola",
      provider: "openai-codex",
      emit: (frame) => frames.push(frame),
      signal: undefined,
      turnId: "t1",
    },
    { createBackend: () => created },
  );
  return { outcome, frames, forceToolCall };
}

test("a reply that skipped suggest_actions returns the recovered bubbles, with no extra frame", async () => {
  const { outcome, frames, forceToolCall } = await run(false);
  expect(forceToolCall).toHaveBeenCalledTimes(1);
  expect(outcome.pendingInteraction).toEqual({
    steps: [{ kind: "suggest_actions", id: "a1", actions: ACTIONS }],
  });
  expect(frames.map((f) => f.type)).toEqual(["user", "text"]);
});

test("an in-band suggest_actions call never pays for the pass", async () => {
  const { outcome, forceToolCall } = await run(true);
  expect(forceToolCall).not.toHaveBeenCalled();
  expect(outcome.pendingInteraction?.steps[0]?.kind).toBe("suggest_actions");
});
