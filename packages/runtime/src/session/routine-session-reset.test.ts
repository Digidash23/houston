import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatMessage, WireEvent } from "@houston/runtime-client";
import { beforeEach, expect, test, vi } from "vitest";
import type {
  CreateSessionOptions,
  HarnessSession,
  ResolvedModel,
} from "../backends/types";

/**
 * The standing server's routine reset, at its own seam: what it reads, and
 * what a conversation looks like when building the fresh session fails.
 */

process.env.HOUSTON_DATA_DIR = mkdtempSync(join(tmpdir(), "houston-rreset-"));
process.env.HOUSTON_WORKSPACE_DIR = process.env.HOUSTON_DATA_DIR;

const store = vi.hoisted(() => ({
  historyReads: 0,
  liveReads: [] as string[],
}));
vi.mock("../store/conversations", async (importOriginal) => {
  const real = await importOriginal<typeof import("../store/conversations")>();
  return {
    ...real,
    getHistory: (...args: Parameters<typeof real.getHistory>) => {
      store.historyReads++;
      return real.getHistory(...args);
    },
    getLiveMessages: (id: string) => {
      store.liveReads.push(id);
      return real.getLiveMessages(id);
    },
  };
});

const { registerBackend } = await import("../backends/registry");
const { resetRoutineSessionIfNeeded } = await import("./routine-session-reset");
const { appendAssistantMessage, appendUserMessage } = await import(
  "../store/conversations"
);
const { saveConversation } = await import("../store/conversation-file");
const { resetPooledRoutineContext } = await import(
  "../turn/turn-routine-context"
);
const { config } = await import("../config");
type Conversation = import("./conversation-record").Conversation;

const MODEL: ResolvedModel = {
  provider: "flaky",
  id: "flaky-1",
  contextWindow: 200_000,
};

function session(): HarnessSession & { disposed: boolean } {
  return {
    disposed: false,
    subscribe: (_l: (e: WireEvent) => void) => () => {},
    prompt: async () => {},
    abort: async () => {},
    dispose() {
      this.disposed = true;
    },
    setModel: async () => {},
    compact: async () => undefined,
    setThinkingLevel: () => {},
    getContextUsage: () => undefined,
  };
}

const built: CreateSessionOptions[] = [];
let failNext = false;
registerBackend("flaky", {
  id: "flaky",
  async createSession(options) {
    built.push(options);
    if (failNext) {
      failNext = false;
      throw new Error("backend unavailable");
    }
    return session();
  },
});

function conv(): Conversation {
  return {
    session: session(),
    queue: Promise.resolve(),
    provider: "flaky",
    model: "flaky-1",
    backendId: "flaky",
    mode: "auto",
    pending: 1,
  };
}

function seed(id: string, fill: number): void {
  appendUserMessage(id, "Run it.", { turnId: `${id}-0` });
  appendAssistantMessage(id, "Done.", {
    turnId: `${id}-0`,
    usage: { context_tokens: fill, output_tokens: 0, cached_tokens: 0 },
  });
  appendUserMessage(id, "Run it.", { turnId: "now" });
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  built.length = 0;
  store.historyReads = 0;
  store.liveReads.length = 0;
});

/** Write a whole routine chat in one save (thousands of appends would each rewrite it). */
function saveChat(id: string, messages: ChatMessage[]): void {
  saveConversation(join(config.dataDir, "conversations"), {
    id,
    title: "Routine",
    createdAt: 1,
    updatedAt: 1,
    messages,
  });
}

/** `runs` usage-less runs of two `chars`-character messages each. */
function usageless(runs: number, chars: number): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let n = 0; n < runs; n++)
    out.push(
      { role: "user", content: "y".repeat(chars), ts: n, turnId: `r${n}` },
      { role: "assistant", content: "x".repeat(chars), ts: n, turnId: `r${n}` },
    );
  out.push({ role: "user", content: "Run it.", ts: runs, turnId: "now" });
  return out;
}

test("the live file is read, never the archive, and ordinary chats not at all", async () => {
  seed("routine-live", 10_000);
  await resetRoutineSessionIfNeeded(
    conv(),
    "routine-live",
    "now",
    "Run it.",
    MODEL,
    "auto",
  );
  await resetRoutineSessionIfNeeded(
    conv(),
    "chat-plain",
    "now",
    "Hi",
    MODEL,
    "auto",
  );
  expect(store.liveReads).toEqual(["routine-live"]);
  expect(store.historyReads).toBe(0);
});

test("many short usage-less runs reset on the standing server exactly as on a pooled worker", async () => {
  const messages = usageless(1_500, 200);
  saveChat("routine-usageless", messages);

  const standing = await resetRoutineSessionIfNeeded(
    conv(),
    "routine-usageless",
    "now",
    "Run it.",
    { ...MODEL, contextWindow: 64_000 },
    "auto",
  );
  const pooled = resetPooledRoutineContext({
    dataDir: mkdtempSync(join(tmpdir(), "houston-rreset-pool-")),
    conversationId: "routine-usageless",
    messages,
    turnId: "now",
    windowTokens: 64_000,
  });
  expect(standing).not.toBeNull();
  expect(pooled).not.toBeNull();
  expect(standing?.preTokens).toBe(pooled?.compaction.pre_tokens);
});

test("a usage-less chat rotated into archive segments still resets from its live tail", async () => {
  // ~9.6 MB of usage-less runs: the save rotates all but a ~2 MiB tail out.
  saveChat("routine-rotated", usageless(1_200, 4_000));
  const reset = await resetRoutineSessionIfNeeded(
    conv(),
    "routine-rotated",
    "now",
    "Run it.",
    MODEL,
    "auto",
  );
  expect(reset).not.toBeNull();
  expect(store.historyReads).toBe(0);
});

test("a rebuild that fails keeps the record, and its next turn retries it", async () => {
  seed("routine-flaky", 150_000);
  const record = conv();
  const old = record.session;
  failNext = true;

  await expect(
    resetRoutineSessionIfNeeded(
      record,
      "routine-flaky",
      "now",
      "Run it.",
      MODEL,
      "auto",
    ),
  ).rejects.toThrow("backend unavailable");
  expect(record.sessionRebuildPending).toBe(true);
  expect((old as ReturnType<typeof session>).disposed).toBe(true);

  // The failed turn left a reply that no longer asks for a reset by itself
  // (an ordinary failure, no usage) — the pending flag still does.
  appendAssistantMessage("routine-flaky", "", { turnId: "now" });
  appendAssistantMessage("routine-flaky", "Small again.", {
    turnId: "later-0",
    usage: { context_tokens: 5_000, output_tokens: 0, cached_tokens: 0 },
  });
  const retry = await resetRoutineSessionIfNeeded(
    record,
    "routine-flaky",
    "later",
    "Run it.",
    MODEL,
    "auto",
  );
  expect(retry).not.toBeNull();
  expect(record.sessionRebuildPending).toBeUndefined();
  expect(record.session).not.toBe(old);
  expect(built.map((o) => o.fresh)).toEqual([true, true]);
});
