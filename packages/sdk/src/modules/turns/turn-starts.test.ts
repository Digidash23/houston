import type {
  EventStreamOptions,
  HoustonEngineClient,
} from "@houston/runtime-client";
import { afterEach, expect, test } from "vitest";
import type { FeedOutput } from "./feed-output";
import { StreamRegistry, streamKey } from "./stream-registry";
import { streamTurn } from "./turn-stream";

/**
 * The registry counts every turn its owner starts on a conversation. A
 * history read takes the count as it goes out and seeds only if the count
 * has not moved, so the count must be up before the turn's bubble is.
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

test("a turn is counted on its conversation before its bubble is pushed", () => {
  const key = streamKey("agent", "chat");
  const countAtBubble: number[] = [];
  const output: FeedOutput = {
    pushFeedItem: (_a, _s, item) => {
      if ((item as { feed_type?: string }).feed_type === "user_message")
        countAtBubble.push(registry.turnsStarted(key));
    },
    sessionStatus: () => {},
    persistBoardStatus: async () => {},
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
