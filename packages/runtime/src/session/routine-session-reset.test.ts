import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WireEvent } from "@houston/runtime-client";
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
  windows: [] as unknown[],
}));
vi.mock("../store/conversations", async (importOriginal) => {
  const real = await importOriginal<typeof import("../store/conversations")>();
  return {
    ...real,
    getHistory: (id: string, window?: unknown) => {
      store.windows.push(window);
      return real.getHistory(
        id,
        window as Parameters<typeof real.getHistory>[1],
      );
    },
  };
});

const { registerBackend } = await import("../backends/registry");
const { resetRoutineSessionIfNeeded } = await import("./routine-session-reset");
const { appendAssistantMessage, appendUserMessage } = await import(
  "../store/conversations"
);
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
  store.windows.length = 0;
});

test("only the chat's tail is read, and ordinary chats are not read at all", async () => {
  seed("routine-tail", 10_000);
  await resetRoutineSessionIfNeeded(
    conv(),
    "routine-tail",
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
  expect(store.windows).toEqual([{ limit: 400 }]);
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
