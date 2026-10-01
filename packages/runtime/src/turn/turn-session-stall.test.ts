import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WireEvent, WireFrame } from "@houston/runtime-client";
import { beforeEach, expect, test, vi } from "vitest";
import type { HarnessBackend, HarnessSession } from "../backends/types";
import { loadConversation } from "../store/conversation-file";
import { runTurn, type TurnDirectories } from "./turn-session";

/**
 * The model-stream stall watchdog on a POOLED turn: the same guard the
 * standing server arms around every prompt (session/stall-watchdog.ts). A
 * provider stream that goes silent must end the turn with the typed "stopped
 * responding" card instead of holding the sandbox until its lifetime runs out.
 */

vi.mock("./turn-runtime", () => ({
  createTurnModelRuntime: async () => ({
    modelRuntime: {},
    model: { provider: "openai-codex", id: "gpt-6", contextWindow: 400_000 },
  }),
}));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

async function directories(): Promise<TurnDirectories> {
  const turnRoot = await mkdtemp(join(tmpdir(), "turn-stall-"));
  const workspaceDir = join(turnRoot, "store", "workspace");
  const dataDir = join(turnRoot, "store", "data");
  await Promise.all([
    mkdir(workspaceDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
  ]);
  return { turnRoot, workspaceDir, dataDir };
}

/**
 * A session whose provider never answers: `prompt` hangs until aborted, then
 * pi's abort echo arrives as an unclassifiable provider_error and the prompt
 * resolves (pi resolves an aborted turn rather than throwing). `liveFor`
 * ticks the liveness feed that many times before going silent.
 */
function silentBackend(opts: { liveFor?: number; tickMs?: number } = {}) {
  const listeners = new Set<(e: WireEvent) => void>();
  const liveness = new Set<() => void>();
  let release: (() => void) | undefined;
  const session: HarnessSession = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeLiveness(listener) {
      liveness.add(listener);
      return () => liveness.delete(listener);
    },
    async prompt() {
      for (let i = 0; i < (opts.liveFor ?? 0); i++) {
        await new Promise((r) => setTimeout(r, opts.tickMs ?? 10));
        for (const tick of liveness) tick();
      }
      if (opts.liveFor !== undefined) {
        for (const l of listeners) l({ type: "text", data: "done" });
        return;
      }
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    async abort() {
      for (const l of listeners)
        l({
          type: "provider_error",
          data: {
            kind: "unknown",
            provider: "openai-codex",
            raw_excerpt: "This operation was aborted",
          },
        });
      release?.();
    },
    dispose: () => undefined,
    setModel: async () => undefined,
    compact: async () => undefined,
    setThinkingLevel: () => undefined,
    getContextUsage: () => undefined,
  };
  const backend: HarnessBackend = {
    id: "pi",
    createSession: async () => session,
  };
  return backend;
}

async function run(
  dirs: TurnDirectories,
  backend: HarnessBackend,
  frames: WireFrame[],
) {
  return runTurn(
    dirs,
    {
      conversationId: "c1",
      text: "hello",
      provider: "openai-codex",
      emit: (frame) => frames.push(frame),
      signal: undefined,
      turnId: "t1",
    },
    { createBackend: () => backend, stallTimeoutMs: 40 },
  );
}

test("a silent provider stream ends the pooled turn with the stopped-responding card", async () => {
  const dirs = await directories();
  const frames: WireFrame[] = [];

  const outcome = await run(dirs, silentBackend(), frames);

  const errors = frames.filter((frame) => frame.type === "provider_error");
  // pi's echo of our own abort is never surfaced; the synthesized card is.
  expect(errors).toHaveLength(1);
  expect(errors[0]?.data).toMatchObject({
    kind: "provider_internal",
    provider: "openai-codex",
    http_status: null,
  });
  expect(outcome.error).toBeUndefined();
  const last = loadConversation(
    join(dirs.dataDir, "conversations"),
    "c1",
  )?.messages.at(-1);
  expect(last?.role).toBe("assistant");
  expect(last?.providerError?.kind).toBe("provider_internal");
});

test("backend liveness keeps a long silent generation alive", async () => {
  const dirs = await directories();
  const frames: WireFrame[] = [];

  // Ten 10 ms ticks span 100 ms, well past the 40 ms window, but each one is
  // proof of life (a tool call's input streaming), so nothing is cut.
  await run(dirs, silentBackend({ liveFor: 10, tickMs: 10 }), frames);

  expect(frames.filter((frame) => frame.type === "provider_error")).toEqual([]);
});
