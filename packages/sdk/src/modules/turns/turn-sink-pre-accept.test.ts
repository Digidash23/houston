import type { ChatMessage, WireFrame } from "@houston/runtime-client";
import { expect, test } from "vitest";
import type { FeedOutput } from "./feed-output";
import { PRE_ACCEPT_MAX_BYTES, PRE_ACCEPT_MAX_FRAMES } from "./pre-accept-turn";
import { TurnSink } from "./turn-sink";

/**
 * A turn stream that attaches after the engine already took our message gets
 * a running `sync` with our echo folded in, and that sync can beat the send's
 * 202. The 202 names the turn: the sink then renders what it held back.
 */

type Item = { feed_type?: string; data?: unknown };

function makeSink(
  reloadHistory: () => Promise<ChatMessage[]> = async () => [],
) {
  const items: Item[] = [];
  const statuses: string[] = [];
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
    sessionKey: "activity-late",
    output,
    mode: "turn",
    nonce: "our-nonce",
    prompt: "hi",
    stop: () => {},
    reloadHistory,
    historyGuard: () => false,
    presettledPollMs: 60_000,
  });
  return { sink, items, statuses };
}

const runningSync = (
  turnId: string,
  partial: string,
  seq = 2,
  resync = false,
): WireFrame => ({
  type: "sync",
  data: { running: true, partial, seq, turnId, ...(resync ? { resync } : {}) },
  seq,
});
const text = (turnId: string, data: string, seq: number): WireFrame => ({
  type: "text",
  data,
  turnId,
  seq,
});
const done = (turnId: string, seq: number): WireFrame => ({
  type: "done",
  data: null,
  turnId,
  seq,
});
const streamed = (items: Item[]) =>
  items.filter((i) => i.feed_type === "assistant_text_streaming");

/** A running t1 sync, then text frames past the pre-accept cap; next seq is END. */
const END = PRE_ACCEPT_MAX_FRAMES + 3;
function overflow(sink: TurnSink): void {
  sink.onFrame(runningSync("t1", "start"));
  for (let seq = 3; seq < END; seq++) sink.onFrame(text("t1", "x", seq));
}

test("a running sync that beat the 202 renders once the 202 names its turn", () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("t1", "Roger that. "));
  sink.onFrame(text("t1", "You said", 3));
  // Nothing renders while the turn could still be another writer's.
  expect(streamed(items)).toEqual([]);

  sink.sendAccepted("t1");

  expect(sink.active).toBe(true);
  expect(streamed(items).map((i) => i.data)).toEqual([
    "Roger that. ",
    "Roger that. You said",
  ]);
  // Bound to t1: its live frames fold, its terminal settles the turn.
  sink.onFrame(text("t1", ": hi", 4));
  sink.onFrame({ type: "done", data: null, turnId: "t1", seq: 5 });
  expect(sink.settled).toBe(true);
  expect(
    items.filter((i) => i.feed_type === "assistant_text").map((i) => i.data),
  ).toEqual(["Roger that. You said: hi"]);
});

test("a terminal frame that beat the 202 settles the claimed turn", () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("t1", "Roger"));
  sink.onFrame({
    type: "error",
    data: { message: "The turn ended unexpectedly" },
    turnId: "t1",
    seq: 3,
  });
  expect(sink.settled).toBe(false);

  sink.sendAccepted("t1");

  expect(sink.settled).toBe(true);
  expect(items).toContainEqual(
    expect.objectContaining({
      feed_type: "system_message",
      data: "The turn ended unexpectedly",
    }),
  );
});

test("once claimed, a later turn's resync is a boundary, never adopted", () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("t1", "Roger"));
  sink.sendAccepted("t1");

  sink.onFrame({
    type: "sync",
    data: { running: true, partial: "someone else", seq: 9, turnId: "t2" },
    seq: 9,
  });

  expect(streamed(items).map((i) => i.data)).toEqual(["Roger"]);
});

test("a 202 naming another turn claims nothing", () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("other", "not ours"));
  sink.onFrame(text("other", " either", 3));

  sink.sendAccepted("t1");

  expect(sink.active).toBe(false);
  expect(streamed(items)).toEqual([]);
});

test("a mismatched 202 does not adopt the old turn's delayed terminal", async () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("t-old", "not ours"));

  sink.sendAccepted("t-new");
  sink.onFrame(done("t-old", 3));
  await Promise.resolve();

  expect(sink.settled).toBe(false);
  expect(sink.active).toBe(false);
  expect(streamed(items)).toEqual([]);
});

test("a mismatched 202 adopts a later resync for its named turn", () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("t-old", "not ours"));

  sink.sendAccepted("t-new");
  sink.onFrame(done("t-old", 3));
  sink.onFrame(runningSync("t-new", "ours", 4, true));

  expect(sink.active).toBe(true);
  expect(streamed(items).map((i) => i.data)).toEqual(["ours"]);
});

test("a 202 that names no turn claims nothing (servers without the id)", () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("t1", "Roger"));

  sink.sendAccepted();

  expect(sink.active).toBe(false);
  expect(streamed(items)).toEqual([]);

  sink.onFrame(done("t1", 3));
  expect(sink.settled).toBe(true);
});

test("a newer sync replaces the kept turn", () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("t1", "Roger"));
  sink.onFrame({
    type: "sync",
    data: { running: false, partial: "", seq: 4 },
    seq: 4,
  });

  sink.sendAccepted("t1");

  expect(sink.active).toBe(false);
  expect(streamed(items)).toEqual([]);
});

test("a held send never claims the turn it was held behind", () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("t1", "the turn we wait on"));
  sink.holdSend();

  sink.sendAccepted("t2");

  expect(streamed(items)).toEqual([]);
});

test("a held retry claims a running sync that beats its 202", () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("t-prev", "previous"));
  sink.holdSend();
  sink.onFrame(done("t-prev", 3));
  sink.onFrame(runningSync("t-new", "partial", 4, true));

  sink.sendAccepted("t-new");
  sink.onFrame(text("t-new", " reply", 5));

  expect(streamed(items).map((i) => i.data)).toEqual([
    "partial",
    "partial reply",
  ]);
  expect(streamed(items).map((i) => i.data)).not.toContain("previous");
  sink.onFrame(done("t-new", 6));
  expect(sink.settled).toBe(true);
});

test("too many pre-accept frames abandon replay until a resync", () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("t1", "start"));
  for (let seq = 3; seq <= PRE_ACCEPT_MAX_FRAMES + 2; seq++) {
    sink.onFrame(text("t1", "x", seq));
  }

  sink.sendAccepted("t1");

  expect(streamed(items)).toHaveLength(0);
  sink.onFrame(
    runningSync("t1", "authoritative", PRE_ACCEPT_MAX_FRAMES + 3, true),
  );
  expect(streamed(items).map((i) => i.data)).toEqual(["authoritative"]);
});

test("oversized pre-accept frames abandon replay until a resync", () => {
  const { sink, items } = makeSink();
  sink.onFrame(runningSync("t1", "start"));
  sink.onFrame(text("t1", "x".repeat(PRE_ACCEPT_MAX_BYTES), 3));

  sink.sendAccepted("t1");

  expect(streamed(items)).toHaveLength(0);
  sink.onFrame(runningSync("t1", "authoritative", 4, true));
  expect(streamed(items).map((i) => i.data)).toEqual(["authoritative"]);
});

test("after an overflow, a clean end settles the reply from history", async () => {
  let reloads = 0;
  const history: ChatMessage[] = [
    { role: "user", content: "hi", ts: 1 },
    { role: "assistant", content: "the whole reply", turnId: "t1", ts: 2 },
  ];
  const { sink, items } = makeSink(async () => {
    reloads++;
    return history;
  });
  overflow(sink);
  sink.sendAccepted("t1");
  sink.onFrame(text("t1", " tail", END));

  sink.onFrame(done("t1", END + 1));
  await new Promise((r) => setTimeout(r, 0));

  expect(reloads).toBe(1);
  expect(sink.settled).toBe(true);
  const final = items.find((i) => i.feed_type === "final_result");
  expect(final?.data).toMatchObject({ result: "the whole reply" });
});

test("after an overflow, a provider error still ends the turn", () => {
  const { sink, items } = makeSink();
  overflow(sink);
  sink.sendAccepted("t1");

  sink.onFrame({
    type: "provider_error",
    data: { kind: "rate_limited", provider: "anthropic", message: "slow down" },
    turnId: "t1",
    seq: END,
  } as WireFrame);

  expect(sink.settled).toBe(true);
  expect(items.some((i) => i.feed_type === "provider_error")).toBe(true);
});

test("after an overflow, an error frame settles with its own message", () => {
  const { sink, items } = makeSink();
  overflow(sink);
  sink.sendAccepted("t1");

  sink.onFrame({
    type: "error",
    data: { message: "Stopped by user" },
    turnId: "t1",
    seq: END,
  });

  expect(sink.settled).toBe(true);
  expect(JSON.stringify(items)).toContain("Stopped by user");
});

test("after an overflow, a running resync restores live folding", () => {
  const { sink, items } = makeSink();
  overflow(sink);
  sink.sendAccepted("t1");

  sink.onFrame(runningSync("t1", "full so far", END, true));
  sink.onFrame(text("t1", " more", END + 1));
  sink.onFrame(done("t1", END + 2));

  expect(streamed(items).map((i) => i.data)).toEqual([
    "full so far",
    "full so far more",
  ]);
  const final = items.find((i) => i.feed_type === "final_result");
  expect(final?.data).toMatchObject({ result: "full so far more" });
});

test("after an overflow, history that lags the end settles from the tail, not as a dead turn", async () => {
  const { sink, items } = makeSink(async () => [
    { role: "user", content: "hi", ts: 1 },
  ]);
  overflow(sink);
  sink.sendAccepted("t1");
  sink.onFrame(text("t1", " tail", END));

  sink.onFrame(done("t1", END + 1));
  await new Promise((r) => setTimeout(r, 0));

  expect(sink.settled).toBe(true);
  expect(sink.terminal).toBe("needs_you");
  const final = items.find((i) => i.feed_type === "final_result");
  expect(final?.data).toMatchObject({ result: " tail" });
});

test("after an overflow, a failed reload reports it and settles from the tail", async () => {
  const { sink, items } = makeSink(async () => {
    throw new Error("offline");
  });
  overflow(sink);
  sink.sendAccepted("t1");
  sink.onFrame(text("t1", " tail", END));

  sink.onFrame(done("t1", END + 1));
  await new Promise((r) => setTimeout(r, 0));

  expect(sink.settled).toBe(true);
  expect(sink.terminal).toBe("needs_you");
  expect(
    items.some(
      (i) =>
        i.feed_type === "system_message" && String(i.data).includes("offline"),
    ),
  ).toBe(true);
});
