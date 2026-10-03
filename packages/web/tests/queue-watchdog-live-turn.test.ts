import type { SessionStartRequest } from "@houston/engine-adapter";
import { maybeQueueSend } from "@houston/engine-adapter/send-queue";
import {
  disposeAllStreams,
  streamTurn,
} from "@houston/engine-adapter/turn-stream";
import { conversationStore } from "@houston/engine-adapter/vm";
import type {
  ChatMessage,
  EventStreamOptions,
  HoustonEngineClient,
  WireFrame,
} from "@houston/runtime-client";
import { EngineError } from "@houston/runtime-client";
import { conversationScope } from "@houston/sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * The cloud pool writes a turn's reply back to the store BEFORE it posts the
 * terminal frame (staging 2026-10-02: reply persisted ~55 s, `done` at
 * 21:33:56.58Z). So a held send's history probe sees a trailing reply while
 * the turn it waits on is still live. The watchdog must defer to that live
 * turn stream: healing there disposed the reply's stream before its `done`
 * and fired the follow-up into the still-held claim (`409 turn running`).
 */

const AGENT = "Houston/Bo";
const msg = (role: "user" | "assistant", content: string): ChatMessage =>
  ({ role, content }) as ChatMessage;

let n = 0;
let key: string;
let dispatched: SessionStartRequest[];
const dispatch = (r: SessionStartRequest) => dispatched.push(r);

/** A live turn: echo + reply text, then the stream stays open until `done()`. */
function liveTurn() {
  let emit: (f: WireFrame) => void = () => {};
  let nonce: string | undefined;
  const engine = {
    async streamEvents(_id: string, o: EventStreamOptions) {
      emit = o.onEvent;
      await new Promise<void>((resolve) => {
        o.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    async sendMessage(_id: string, _text: string, opts?: { nonce?: string }) {
      nonce = opts?.nonce;
      queueMicrotask(() => {
        emit({
          type: "sync",
          data: { running: false, partial: "", seq: 0 },
          seq: 0,
        });
        emit({
          type: "user",
          data: { content: "first", ts: 1, nonce },
          turnId: "t-1",
          seq: 1,
        });
        emit({ type: "text", data: "Reply", turnId: "t-1", seq: 2 });
      });
    },
    async getHistory() {
      return { id: "c", title: "", messages: [] };
    },
  } as unknown as HoustonEngineClient;
  const done = () => emit({ type: "done", data: null, turnId: "t-1", seq: 3 });
  return { engine, done };
}

const running = () =>
  (
    conversationStore.getSnapshot(conversationScope(AGENT, key)) as
      | { running?: boolean }
      | undefined
  )?.running;

beforeEach(() => {
  vi.useFakeTimers();
  key = `live-${n++}`;
  dispatched = [];
});

afterEach(() => {
  disposeAllStreams();
  vi.useRealTimers();
});

it("never heals over a live turn stream: the follow-up waits for the terminal frame", async () => {
  const { engine, done } = liveTurn();
  void streamTurn(engine, AGENT, key, "first", async () => {}, {
    tuning: { idleTimeoutMs: 600_000 },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(running()).toBe(true);

  // The reply is already persisted; the turn's `done` is not out yet.
  const probe = vi.fn(async () => [
    msg("user", "first"),
    msg("assistant", "Reply"),
  ]);
  maybeQueueSend(
    AGENT,
    { sessionKey: key, prompt: "follow-up" },
    dispatch,
    probe,
  );

  await vi.advanceTimersByTimeAsync(10_000);
  expect(probe).toHaveBeenCalled();
  expect(dispatched).toHaveLength(0);
  expect(running()).toBe(true);

  done();
  await vi.advanceTimersByTimeAsync(0);
  expect(running()).toBe(false);
  expect(dispatched.map((r) => r.prompt)).toEqual(["follow-up"]);
});

it("still rescues the hold when the live turn never ends", async () => {
  const { engine } = liveTurn();
  void streamTurn(engine, AGENT, key, "first", async () => {}, {
    tuning: { idleTimeoutMs: 600_000 },
  });
  await vi.advanceTimersByTimeAsync(0);
  const probe = vi.fn(async () => [
    msg("user", "first"),
    msg("assistant", "Reply"),
  ]);
  maybeQueueSend(
    AGENT,
    { sessionKey: key, prompt: "follow-up" },
    dispatch,
    probe,
  );

  await vi.advanceTimersByTimeAsync(120_000);
  expect(dispatched.map((r) => r.prompt)).toEqual(["follow-up"]);
});

it("never flushes over a held send, even past the grace", async () => {
  // The claim outlives the grace (a dead worker's claim waits for the 75 s
  // reap): the held send must keep its place, and the queue waits behind it.
  const engine = {
    async streamEvents(_id: string, o: EventStreamOptions) {
      await new Promise<void>((resolve) => {
        o.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    async sendMessage() {
      throw new EngineError(409, JSON.stringify({ error: "turn running" }));
    },
    async getHistory() {
      return { id: "c", title: "", messages: [] };
    },
  } as unknown as HoustonEngineClient;
  void streamTurn(engine, AGENT, key, "held", async () => {}, {
    tuning: { idleTimeoutMs: 600_000 },
  });
  await vi.advanceTimersByTimeAsync(0);
  const probe = vi.fn(async () => [msg("user", "x"), msg("assistant", "y")]);
  maybeQueueSend(AGENT, { sessionKey: key, prompt: "queued" }, dispatch, probe);

  await vi.advanceTimersByTimeAsync(200_000);
  expect(probe).toHaveBeenCalled();
  expect(dispatched).toHaveLength(0);
  expect(running()).toBe(true);
});
