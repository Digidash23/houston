import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { routineRunPreamble } from "@houston/domain";
import type { WireFrame } from "@houston/runtime-client";
import { beforeEach, expect, test, vi } from "vitest";
import { writeAuthFile } from "../auth/auth-file";
import { simulatedClaudeApi } from "../backends/claude/simulated-api.test-support";
import type {
  CreateSessionOptions,
  HarnessBackend,
  HarnessSession,
  ResolvedModel,
} from "../backends/types";
import {
  appendAssistantMessageAt,
  appendUserMessageAt,
  loadConversation,
} from "../store/conversation-file";
import { createTurnBackend, turnClaudeLayout } from "./turn-backend";
import { runTurn, type TurnDirectories } from "./turn-session";

/**
 * The routine overflow on a POOLED worker, which runs no Houston autocompact
 * at all: every turn hydrates the conversation, resumes its native session
 * (the Claude SDK session named in `sessions.json`, or pi's newest tail) and
 * sends it whole. A shared routine chat past its window failed on every fire.
 */

const target = vi.hoisted(() => ({
  model: {
    provider: "anthropic",
    id: "claude-opus-5",
    contextWindow: 1_000_000,
    reasoning: false,
  } as ResolvedModel,
}));
vi.mock("./turn-runtime", () => ({
  createTurnModelRuntime: async () => ({
    modelRuntime: {},
    model: target.model,
  }),
}));

const WINDOW = 200_000;
const PROMPT = `${routineRunPreamble("Invoice watch")}Check the billing inbox for new invoices and list any that are overdue.`;
const ID = "routine-invoice-watch";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

async function directories(): Promise<TurnDirectories> {
  const turnRoot = await mkdtemp(join(tmpdir(), "routine-pooled-"));
  const workspaceDir = join(turnRoot, "store", "workspace");
  const dataDir = join(turnRoot, "store", "data");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  writeAuthFile(join(dataDir, "auth.json"), {
    anthropic: {
      type: "oauth",
      access: "sk-ant-oat01-test",
      refresh: "",
      expires: Date.now() + 60_000,
    },
  });
  return { turnRoot, workspaceDir, dataDir };
}

/** A routine chat that ran `runs` times, the last run ending at `lastFill`. */
function seedRoutineChat(dataDir: string, runs: number, lastFill: number) {
  const dir = join(dataDir, "conversations");
  for (let run = 0; run < runs; run++) {
    appendUserMessageAt(dir, ID, PROMPT, { turnId: `run-${run}` });
    appendAssistantMessageAt(
      dir,
      ID,
      `Run ${run}: INV-${1000 + run} is overdue.`,
      {
        turnId: `run-${run}`,
        usage: {
          context_tokens: Math.round((lastFill * (run + 1)) / runs),
          output_tokens: 300,
          cached_tokens: 0,
        },
      },
    );
  }
}

async function seedClaudeSession(
  dirs: TurnDirectories,
  api: ReturnType<typeof simulatedClaudeApi>,
  tokens: number,
) {
  const layout = turnClaudeLayout(dirs.turnRoot, dirs.dataDir, ID);
  const slugDir = join(
    layout.configDir,
    "projects",
    dirs.workspaceDir.replace(/[^A-Za-z0-9]/g, "-"),
  );
  await mkdir(slugDir, { recursive: true });
  await writeFile(join(slugDir, "sim-old.jsonl"), "{}\n");
  await writeFile(layout.sessionsFile, JSON.stringify({ [ID]: "sim-old" }));
  api.seedSession("sim-old", tokens);
  return join(slugDir, "sim-old.jsonl");
}

function claudeSdk(api: ReturnType<typeof simulatedClaudeApi>) {
  const makeMcp = ((input: { name: string }) => ({
    type: "sdk",
    name: input.name,
    instance: {},
  })) as typeof createSdkMcpServer;
  return { query: api.query, createSdkMcpServer: makeMcp };
}

async function fire(
  dirs: TurnDirectories,
  turnId: string,
  deps: Parameters<typeof runTurn>[2],
  frames: WireFrame[] = [],
) {
  return runTurn(
    dirs,
    {
      conversationId: ID,
      text: PROMPT,
      provider: target.model.provider,
      emit: (frame) => frames.push(frame),
      signal: undefined,
      turnId,
      mode: "auto",
    },
    deps,
  );
}

const lastAssistant = (dataDir: string) =>
  loadConversation(join(dataDir, "conversations"), ID)
    ?.messages.filter((m) => m.role === "assistant")
    .at(-1);

test("a pooled Claude routine run past its window starts fresh, fits and drops the old session", async () => {
  target.model = {
    ...target.model,
    provider: "anthropic",
    id: "claude-opus-5",
  };
  const dirs = await directories();
  const api = simulatedClaudeApi({
    windowTokens: WINDOW,
    systemTokens: 12_000,
    runGrowthTokens: 6_000,
  });
  seedRoutineChat(dirs.dataDir, 40, 191_000);
  const oldTranscript = await seedClaudeSession(dirs, api, 191_000);
  const frames: WireFrame[] = [];

  await fire(dirs, "reset-run", { claudeSdk: claudeSdk(api) }, frames);

  const call = api.calls.at(-1);
  expect(call?.resume).toBeUndefined();
  expect(call?.refused).toBe(false);
  expect(call?.requestTokens).toBeLessThan(WINDOW / 2);
  expect(call?.prompt).toContain("This automation has run before");
  expect(call?.prompt).toContain("INV-1039 is overdue");
  expect(lastAssistant(dirs.dataDir)?.providerError).toBeUndefined();
  expect(lastAssistant(dirs.dataDir)?.compaction).toMatchObject({
    trigger: "proactive",
    pre_tokens: 191_300,
  });
  expect(frames.some((f) => f.type === "context_compacted")).toBe(true);
  // The overgrown session is deleted, so the sync-back deletes it remotely
  // and no later worker hydrates it again.
  expect(existsSync(oldTranscript)).toBe(false);

  // The next fire resumes the fresh session, with nothing replayed.
  await fire(dirs, "next-run", { claudeSdk: claudeSdk(api) });
  expect(api.calls.at(-1)?.resume).toBe("sim-1");
  expect(api.calls.at(-1)?.prompt).toBe(PROMPT);
  expect(lastAssistant(dirs.dataDir)?.compaction).toBeUndefined();
});

test("a pooled Claude routine run inside its budget resumes as before", async () => {
  target.model = {
    ...target.model,
    provider: "anthropic",
    id: "claude-opus-5",
  };
  const dirs = await directories();
  const api = simulatedClaudeApi({
    windowTokens: WINDOW,
    systemTokens: 12_000,
    runGrowthTokens: 6_000,
  });
  seedRoutineChat(dirs.dataDir, 5, 40_000);
  await seedClaudeSession(dirs, api, 40_000);

  await fire(dirs, "small-run", { claudeSdk: claudeSdk(api) });

  expect(api.calls.at(-1)?.resume).toBe("sim-old");
  expect(api.calls.at(-1)?.prompt).toBe(PROMPT);
});

test("a pooled pi routine run past its window opens a fresh pi session with the bounded replay", async () => {
  target.model = {
    provider: "openai-codex",
    id: "gpt-5.5",
    contextWindow: 272_000,
    reasoning: false,
  };
  const dirs = await directories();
  seedRoutineChat(dirs.dataDir, 40, 180_000);
  const sessionDir = join(dirs.dataDir, "sessions", ID);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "2026-09-01T00-00-00-000Z_old.jsonl"),
    `${JSON.stringify({ type: "session" })}\n`,
  );
  const calls: { options: CreateSessionOptions; prompts: string[] }[] = [];
  const pi: HarnessBackend = {
    id: "pi",
    async createSession(options) {
      const call = { options, prompts: [] as string[] };
      calls.push(call);
      return {
        subscribe: () => () => undefined,
        prompt: async (prompt) => {
          call.prompts.push(prompt);
        },
        abort: async () => undefined,
        dispose: () => undefined,
        setModel: async () => undefined,
        compact: async () => undefined,
        setThinkingLevel: () => undefined,
        getContextUsage: () => undefined,
      } satisfies HarnessSession;
    },
  };

  await fire(dirs, "pi-reset-run", {
    createBackend: (provider, input) =>
      provider === "anthropic" ? createTurnBackend(provider, input) : pi,
  });

  expect(calls[0]?.options.fresh).toBe(true);
  const prompt = calls[0]?.prompts[0] ?? "";
  expect(prompt).toContain("This automation has run before");
  // Bounded by the routine budget, never the 80%-of-window carry.
  expect(prompt.length).toBeLessThanOrEqual(24_000 * 4 + 2_000);
  expect(await readdir(sessionDir).catch(() => [])).not.toContain(
    "2026-09-01T00-00-00-000Z_old.jsonl",
  );
  expect(lastAssistant(dirs.dataDir)?.compaction).toMatchObject({
    trigger: "proactive",
  });
});
