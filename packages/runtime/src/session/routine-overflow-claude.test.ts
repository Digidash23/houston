import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { routineRunPreamble } from "@houston/domain";
import { beforeEach, expect, test, vi } from "vitest";
import type { ResolvedModel } from "../backends/types";

/**
 * THE PRODUCTION FAILURE, reproduced through the standing server's real turn
 * path and the real Claude Agent SDK backend: a shared routine chat (one
 * conversation, every fire) whose resumed SDK session has outgrown the model's
 * window. Every later run resumed that session, was refused "Prompt is too
 * long", and the routine failed on every fire (~23,000 routine runs in 30
 * days, 98% of them on Anthropic). Autocompact never saved it: a freshly built
 * Claude session reports no context fill, and a summarization inside the
 * overflowing session is itself too long.
 *
 * Only the Anthropic API is simulated (simulated-api.test-support.ts): the
 * session cache, the sessions store, the resume decision and the transcript
 * are the production code.
 */

process.env.HOUSTON_HOME = mkdtempSync(join(tmpdir(), "houston-rovf-home-"));
process.env.HOUSTON_DATA_DIR = mkdtempSync(
  join(tmpdir(), "houston-rovf-data-"),
);
process.env.HOUSTON_WORKSPACE_DIR = mkdtempSync(
  join(tmpdir(), "houston-rovf-ws-"),
);

// claude-opus-5: 1M in pi's registry, 200k on the standard plan — Houston's
// catalog (MODEL_WINDOW_OVERRIDES) sizes it at 200k, as the simulated API does.
const target = vi.hoisted(() => ({
  model: {
    provider: "anthropic",
    id: "claude-opus-5",
    contextWindow: 1_000_000,
    reasoning: false,
  } as ResolvedModel,
}));
vi.mock("../ai/providers", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ai/providers")>();
  return {
    ...real,
    resolveModel: () => target.model,
    activeEffort: () => null,
  };
});

await import("./conversation-cache");
const { runTurn, disposeConversation } = await import("./chat");
const { registerBackend } = await import("../backends/registry");
const { createClaudeBackend } = await import("../backends/claude/backend");
const { serverClaudeLayout } = await import("../backends/claude/paths");
const { simulatedClaudeApi } = await import(
  "../backends/claude/simulated-api.test-support"
);
const { toolSelection } = await import("./session-tools");
const { config } = await import("../config");
const { appendAssistantMessage, appendUserMessage, getHistory } = await import(
  "../store/conversations"
);

const WINDOW = 200_000;
const PIN = {
  provider: "anthropic",
  model: "claude-opus-5",
  mode: "auto" as const,
};
const PROMPT = `${routineRunPreamble("Invoice watch")}Check the billing inbox for new invoices and list any that are overdue.`;

function useSimulatedApi() {
  const api = simulatedClaudeApi({
    windowTokens: WINDOW,
    systemTokens: 12_000,
    runGrowthTokens: 6_000,
  });
  const makeMcp = ((input: { name: string }) => ({
    type: "sdk",
    name: input.name,
    instance: {},
  })) as typeof createSdkMcpServer;
  registerBackend(
    "anthropic",
    createClaudeBackend({
      workspaceDir: config.workspaceDir,
      layout: serverClaudeLayout(config.dataDir),
      readToken: () => ({ kind: "api-key", value: "sk-ant-api-test" }),
      toolSelection,
      systemPrompt: "You are a test agent.",
      sdk: { query: api.query, createSdkMcpServer: makeMcp },
    }),
  );
  return api;
}

/** A routine chat that ran `runs` times, the last run ending at `lastFill`. */
function seedRoutineChat(id: string, runs: number, lastFill: number): void {
  for (let run = 0; run < runs; run++) {
    appendUserMessage(id, PROMPT, { turnId: `${id}-run-${run}` });
    appendAssistantMessage(
      id,
      `Run ${run}: invoice INV-${1000 + run} is overdue.`,
      {
        turnId: `${id}-run-${run}`,
        usage: {
          context_tokens: Math.round((lastFill * (run + 1)) / runs),
          output_tokens: 300,
          cached_tokens: 0,
        },
      },
    );
  }
}

/** Map the conversation onto an SDK session holding `tokens` tokens. */
function seedSdkSession(
  api: ReturnType<typeof simulatedClaudeApi>,
  id: string,
  tokens: number,
): void {
  const layout = serverClaudeLayout(config.dataDir);
  api.seedSession("sim-old", tokens);
  const slug = config.workspaceDir.replace(/[^A-Za-z0-9]/g, "-");
  mkdirSync(join(layout.configDir, "projects", slug), { recursive: true });
  writeFileSync(
    join(layout.configDir, "projects", slug, "sim-old.jsonl"),
    "{}\n",
  );
  mkdirSync(dirname(layout.sessionsFile), { recursive: true });
  writeFileSync(layout.sessionsFile, JSON.stringify({ [id]: "sim-old" }));
}

const lastAssistant = (id: string) =>
  getHistory(id)
    ?.messages.filter((m) => m.role === "assistant")
    .at(-1);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

test("a routine run whose shared chat outgrew the window starts fresh and fits", async () => {
  const id = "routine-invoice-watch";
  const api = useSimulatedApi();
  seedRoutineChat(id, 40, 191_000);
  seedSdkSession(api, id, 191_000);

  await runTurn(id, PROMPT, undefined, PIN);

  const first = api.calls.at(-1);
  // The overgrown SDK session is never resumed again...
  expect(first?.resume).toBeUndefined();
  expect(first?.refused).toBe(false);
  // ...and the fresh one starts well inside the window, carrying the recent
  // runs as its memory — each earlier run's instructions collapsed to a line.
  expect(first?.requestTokens).toBeLessThan(WINDOW / 2);
  expect(first?.prompt).toContain("This automation has run before");
  expect(first?.prompt).toContain("invoice INV-1039 is overdue");
  expect(first?.prompt.split("Check the billing inbox")).toHaveLength(2);
  expect(lastAssistant(id)?.providerError).toBeUndefined();
  // The boundary is on the record, so the routine's chat draws the divider.
  expect(lastAssistant(id)?.compaction).toMatchObject({
    trigger: "proactive",
    pre_tokens: 191_300,
  });
});

test("the run after a reset resumes the fresh session with nothing replayed", async () => {
  const id = "routine-after-reset";
  const api = useSimulatedApi();
  seedRoutineChat(id, 40, 191_000);
  seedSdkSession(api, id, 191_000);

  await runTurn(id, PROMPT, undefined, PIN);
  // A fresh process (idle eviction, pod restart) must resume it from disk too.
  await disposeConversation(id);
  await runTurn(id, PROMPT, undefined, PIN);

  const second = api.calls.at(-1);
  expect(second?.resume).toBe("sim-1");
  expect(second?.refused).toBe(false);
  expect(second?.prompt).toBe(PROMPT);
  expect(lastAssistant(id)?.compaction).toBeUndefined();
});

test("a routine chat still inside its budget keeps resuming its session", async () => {
  const id = "routine-small";
  const api = useSimulatedApi();
  seedRoutineChat(id, 5, 40_000);
  seedSdkSession(api, id, 40_000);

  await runTurn(id, PROMPT, undefined, PIN);

  expect(api.calls.at(-1)?.resume).toBe("sim-old");
  expect(api.calls.at(-1)?.prompt).toBe(PROMPT);
  expect(lastAssistant(id)?.compaction).toBeUndefined();
});

test("a routine whose last run overflowed recovers on the next fire", async () => {
  const id = "routine-overflowed";
  const api = useSimulatedApi();
  // Small at the start of the last run, which then read enough to overflow
  // mid-run: the fill alone would not call for a reset, the overflow does.
  seedRoutineChat(id, 3, 30_000);
  appendUserMessage(id, PROMPT, { turnId: "overflowed-run" });
  appendAssistantMessage(id, "", {
    turnId: "overflowed-run",
    providerError: {
      kind: "context_overflow",
      provider: "anthropic",
      model: "claude-opus-5",
      context_window_tokens: WINDOW,
      prompt_tokens: 204_000,
      message: "Prompt is too long: 204000 tokens > 200000 maximum",
    },
  });
  seedSdkSession(api, id, 204_000);

  await runTurn(id, PROMPT, undefined, PIN);

  expect(api.calls.at(-1)?.resume).toBeUndefined();
  expect(api.calls.at(-1)?.refused).toBe(false);
  expect(lastAssistant(id)?.providerError).toBeUndefined();
});

test("an ordinary chat is left on its session, whatever its size", async () => {
  const id = "chat-interactive";
  const api = useSimulatedApi();
  seedRoutineChat(id, 40, 150_000);
  seedSdkSession(api, id, 150_000);

  await runTurn(id, "What changed today?", undefined, PIN);

  expect(api.calls.at(-1)?.resume).toBe("sim-old");
  expect(lastAssistant(id)?.compaction).toBeUndefined();
});
