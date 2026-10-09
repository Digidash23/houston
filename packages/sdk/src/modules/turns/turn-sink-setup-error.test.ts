import type { WireFrame } from "@houston/runtime-client";
import { type ChatMessage, EngineError } from "@houston/runtime-client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { FeedOutput } from "./feed-output";
import { PRESETTLED_GONE_MS } from "./stream-tuning";
import { TurnSink } from "./turn-sink";

/**
 * A pooled turn that fails during setup (H-003) answers with one terminal
 * `error` frame and nothing else: no echo, no running sync, and its
 * conversation is never persisted. That frame can reach the stream a few ms
 * BEFORE the send's 202, and history answers 404 for the conversation.
 */

type Item = { feed_type?: string; data?: unknown; notice?: string };

const POLL_MS = 1_500;

function makeSink(reloadHistory: () => Promise<ChatMessage[]>) {
  const items: Item[] = [];
  const statuses: string[] = [];
  const stop = vi.fn();
  const output: FeedOutput = {
    pushFeedItem: (_a, _s, item) => {
      items.push(item as Item);
    },
    sessionStatus: (_a, _s, status) => {
      statuses.push(status);
    },
    persistBoardStatus: async () => {},
  };
  const sink = new TurnSink({
    agentPath: "Houston/Bo",
    sessionKey: "activity-new",
    output,
    mode: "turn",
    nonce: "our-nonce",
    prompt: "hi",
    stop,
    reloadHistory,
    historyGuard: () => false,
    presettledPollMs: POLL_MS,
  });
  return { sink, items, statuses, stop };
}

const idleSync: WireFrame = {
  type: "sync",
  data: { running: false, partial: "", seq: 1 },
  seq: 1,
};
const setupError = (turnId: string, code = "hydrate_over_cap"): WireFrame =>
  ({
    type: "error",
    data: { message: code, code, detail: "over the cap" },
    turnId,
    seq: 2,
  }) as WireFrame;
const notFound = () =>
  Promise.reject(
    new EngineError(404, JSON.stringify({ error: "conversation not found" })),
  );
const systemLines = (items: Item[]) =>
  items.filter((i) => i.feed_type === "system_message");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("a setup error that beats the 202 settles the turn the 202 names", async () => {
  const reload = vi.fn(notFound);
  const { sink, items, statuses, stop } = makeSink(reload);
  sink.onFrame(idleSync);
  sink.onFrame(setupError("t1"));
  expect(sink.settled).toBe(false);

  sink.sendAccepted("t1");

  expect(sink.settled).toBe(true);
  expect(stop).toHaveBeenCalled();
  expect(statuses).toEqual(["error"]);
  const [line] = systemLines(items);
  expect(line).toMatchObject({ notice: "agent_too_large" });
  // The authored default, never the worker's bare code.
  expect(String(line.data)).not.toContain("hydrate_over_cap");
  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MS * 2);
  expect(reload).not.toHaveBeenCalled();
});

test("every other setup code settles with the setup-failed notice", () => {
  const { sink, items } = makeSink(notFound);
  sink.onFrame(idleSync);
  sink.onFrame(setupError("t1", "claim_fenced"));
  sink.sendAccepted("t1");
  expect(systemLines(items)).toEqual([
    expect.objectContaining({ notice: "agent_setup_failed" }),
  ]);
});

test("a kept terminal survives a reconnect's idle resync before the 202", () => {
  const { sink } = makeSink(notFound);
  sink.onFrame(idleSync);
  sink.onFrame(setupError("t1"));
  sink.onFrame({
    type: "sync",
    data: { running: false, partial: "", seq: 3, resync: true },
    seq: 3,
  });
  sink.sendAccepted("t1");
  expect(sink.settled).toBe(true);
});

test("a held send's setup error that beats its 202 is still claimed", () => {
  const { sink } = makeSink(notFound);
  sink.onFrame(idleSync);
  sink.holdSend();
  sink.onFrame(setupError("t-resend"));
  sink.sendAccepted("t-resend");
  expect(sink.settled).toBe(true);
});

test("another turn's terminal is never claimed by a 202 naming ours", () => {
  const { sink, items } = makeSink(notFound);
  sink.onFrame(idleSync);
  sink.onFrame(setupError("someone-else"));
  sink.sendAccepted("t1");
  expect(sink.settled).toBe(false);
  expect(systemLines(items)).toEqual([]);
  sink.dispose();
});

test("a conversation that stays not found after the 202 settles, then polls no more", async () => {
  const reload = vi.fn(notFound);
  const { sink, items, stop } = makeSink(reload);
  sink.onFrame(idleSync);
  // The setup error never reached this stream at all.
  sink.sendAccepted("t1");

  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MS - POLL_MS);
  expect(sink.settled).toBe(false);
  await vi.advanceTimersByTimeAsync(POLL_MS * 2);
  expect(sink.settled).toBe(true);
  expect(stop).toHaveBeenCalled();
  expect(systemLines(items)).toEqual([
    expect.objectContaining({ notice: "agent_setup_failed" }),
  ]);
  const calls = reload.mock.calls.length;
  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MS * 4);
  expect(reload.mock.calls.length).toBe(calls);
});

test("a not found that turns into a history restarts the bound", async () => {
  let gone = true;
  const reload = vi.fn(() =>
    gone ? notFound() : Promise.resolve([] as ChatMessage[]),
  );
  const { sink } = makeSink(reload);
  sink.onFrame(idleSync);
  sink.sendAccepted("t1");
  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MS - POLL_MS);
  gone = false;
  await vi.advanceTimersByTimeAsync(POLL_MS * 2);
  gone = true;
  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MS - POLL_MS * 2);
  expect(sink.settled).toBe(false);
  sink.dispose();
});

test("a reload that fails for any other reason keeps the turn waiting", async () => {
  const reload = vi.fn(() => Promise.reject(new TypeError("Load failed")));
  const { sink } = makeSink(reload);
  sink.onFrame(idleSync);
  sink.sendAccepted("t1");
  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MS * 2);
  expect(sink.settled).toBe(false);
  sink.dispose();
});
