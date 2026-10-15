import type {
  ChatMessage,
  EventStreamOptions,
  HoustonEngineClient,
  WireFrame,
} from "@houston/runtime-client";
import { afterEach, expect, test } from "vitest";
import { createAuthExpiryNotifier } from "../../auth-expiry";
import type { ModuleContext } from "../../module-context";
import type { SdkConfig } from "../../ports";
import { ScopeStore } from "../../store";
import type { FeedOutput } from "./feed-output";
import { createTurnsModule } from "./index";
import {
  OVERTAKEN_READ_RETRIES,
  readPastOwnTurns,
} from "./read-past-own-turns";
import { StreamRegistry, streamKey } from "./stream-registry";
import { streamTurn } from "./turn-stream";
import { type ConversationVM, conversationScope } from "./vm-output";

/**
 * A history read a send overtook. The registry counts every turn its owner
 * starts on a conversation, before the turn's bubble; a read taken before
 * that count moved answers from before the turn, so it is read again once
 * the turn let go of the conversation, and only a read past every own turn
 * may seed.
 */

const registry = new StreamRegistry();
afterEach(() => registry.disposeAll());

/** An engine whose stream stays open until the client lets it go. */
const engine = {
  streamEvents: (_id: string, opts: EventStreamOptions) =>
    new Promise<void>((resolve) => {
      if (opts.signal?.aborted) return resolve();
      opts.signal?.addEventListener("abort", () => resolve(), { once: true });
    }),
  sendMessage: async () => ({ ok: true }),
  getHistory: async () => ({ id: "c", title: "", messages: [] }),
} as unknown as HoustonEngineClient;

const silent: FeedOutput = {
  pushFeedItem: () => {},
  sessionStatus: () => {},
  persistBoardStatus: async () => {},
};

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test("a turn is counted on its conversation before its bubble is pushed", () => {
  const key = streamKey("agent", "chat");
  const countAtBubble: number[] = [];
  const output: FeedOutput = {
    ...silent,
    pushFeedItem: (_a, _s, item) => {
      if ((item as { feed_type?: string }).feed_type === "user_message")
        countAtBubble.push(registry.turnsStarted(key));
    },
  };

  expect(registry.turnsStarted(key)).toBe(0);
  // Not awaited: a turn resolves when it settles. The count and the bubble
  // both land before its first await, the second turn replacing the first.
  void streamTurn(engine, "agent", "chat", "first", output, registry);
  void streamTurn(engine, "agent", "chat", "second", output, registry);

  expect(countAtBubble).toEqual([1, 2]);
  expect(registry.turnsStarted(key)).toBe(2);
  expect(registry.turnsStarted(streamKey("agent", "other"))).toBe(0);
});

test("a read a send overtook is read again once that turn let go", async () => {
  const key = streamKey("agent", "fresh-chat");
  const first = deferred<string>();
  const answers = [first.promise, Promise.resolve("after the turn")];
  let reads = 0;
  const read = readPastOwnTurns(registry, key, () => answers[reads++]);

  void streamTurn(engine, "agent", "fresh-chat", "hi", silent, registry);
  first.resolve("before the turn");
  await new Promise((r) => setTimeout(r, 10));
  expect(reads).toBe(1); // the turn still holds the conversation

  registry.disposeAll();
  await expect(read).resolves.toEqual({ value: "after the turn", mark: 1 });
  expect(reads).toBe(2);
});

test("a read every retry finds overtaken comes back with its stale mark", async () => {
  const key = streamKey("agent", "busy-chat");
  let reads = 0;
  const { value, mark } = await readPastOwnTurns(registry, key, async () => {
    reads++;
    registry.noteTurnStart(key); // a send lands during every read
    return reads;
  });
  expect(reads).toBe(OVERTAKEN_READ_RETRIES + 1);
  expect(value).toBe(reads);
  expect(mark).not.toBe(registry.turnsStarted(key));
});

test("observe seeds the read taken past a send, never the one it overtook", async () => {
  const store = new ScopeStore();
  const first = deferred<ChatMessage[]>();
  const settled: ChatMessage[] = [
    { role: "user", content: "earlier", ts: 1, turnId: "t0" },
    { role: "assistant", content: "answer", ts: 2, turnId: "t0" },
    { role: "user", content: "hi", ts: 3, turnId: "t1" },
    { role: "assistant", content: "hi there", ts: 4, turnId: "t1" },
  ];
  let reads = 0;
  const client = {
    async streamEvents(_id: string, o: { onEvent: (f: WireFrame) => void }) {
      o.onEvent({
        type: "sync",
        data: { running: false, partial: "", seq: 0 },
      });
      o.onEvent({ type: "text", data: "hi there", turnId: "t1", seq: 1 });
      o.onEvent({ type: "done", data: null, turnId: "t1", seq: 2 });
    },
    async sendMessage() {},
    async getHistory() {
      reads++;
      const messages = reads === 1 ? await first.promise : settled;
      return { id: "c1", title: "", messages };
    },
  } as unknown as HoustonEngineClient;
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const ctx: ModuleContext = {
    config: {
      baseUrl: "http://x",
      ports: { logger } as unknown as SdkConfig["ports"],
      reactivity: false,
    },
    store,
    clientFor: () => client,
    authExpiry: createAuthExpiryNotifier(store),
    registerCommand: () => {},
  };
  const mod = createTurnsModule(ctx, async () => {});
  const vm = () =>
    store.getSnapshot(conversationScope("", "c1")) as ConversationVM;

  const observing = mod.observe("c1", "");
  await mod.send({ conversationId: "c1", text: "hi" });
  first.resolve([]); // answered from before the send
  await observing;

  // The turn's own settle may read too; the overtaken read went again.
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(vm().feed.map((f) => f.data)).toEqual(
    expect.arrayContaining(["earlier", "answer", "hi", "hi there"]),
  );
});
