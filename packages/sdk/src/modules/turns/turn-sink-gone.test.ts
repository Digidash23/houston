import type { ChatMessage } from "@houston/runtime-client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { noticeEndsTurn } from "./notice-ends-turn";
import {
  PRESETTLED_GONE_MAX_POLL_MS,
  PRESETTLED_GONE_MS,
} from "./stream-tuning";
import { TURN_UNCONFIRMED_MESSAGE } from "./turn-notices";
import {
  idleSync,
  makeSink,
  notFound,
  POLL_MS,
  systemLines,
} from "./turn-sink-setup-fixtures";

/**
 * The backstop for a setup failure whose frame never reached the stream at
 * all (H-003): history answers 404 for a conversation that was never saved.
 * It used to be read every 1.5 s until the person left.
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("a conversation still not found long after the 202 settles as lost, then polls no more", async () => {
  const reload = vi.fn(notFound);
  const { sink, items, stopped } = makeSink(reload);
  sink.onFrame(idleSync);
  sink.sendAccepted("t1");

  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MS - POLL_MS);
  expect(sink.settled).toBe(false);
  // Backed off: far fewer reads than one per 1.5 s.
  expect(reload.mock.calls.length).toBeLessThan(
    PRESETTLED_GONE_MS / POLL_MS / 4,
  );
  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MAX_POLL_MS * 2);
  expect(sink.settled).toBe(true);
  // Only this client's stream closes; nothing is cancelled server-side.
  expect(stopped()).toBe(true);
  const [line] = systemLines(items);
  // Its own line: we do not know the message failed, so no "send it again".
  expect(line).toMatchObject({ notice: "turn_unconfirmed", cause: "gone" });
  expect(line.data).toBe(TURN_UNCONFIRMED_MESSAGE);
  expect(noticeEndsTurn("turn_unconfirmed")).toBe(true);
  // Not proof that nothing was saved: the bubble keeps its state.
  expect(line.fails_pending).toBeUndefined();
  const calls = reload.mock.calls.length;
  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MS * 4);
  expect(reload.mock.calls.length).toBe(calls);
});

test("a live frame after the 202 stops the not-found clock", async () => {
  const reload = vi.fn(notFound);
  const { sink, items } = makeSink(reload);
  sink.onFrame(idleSync);
  sink.sendAccepted("t1");
  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MS / 2);
  sink.onFrame({ type: "text", data: "Working", turnId: "t1", seq: 2 });
  const calls = reload.mock.calls.length;

  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MS * 2);
  expect(reload.mock.calls.length).toBe(calls);
  expect(systemLines(items)).toEqual([]);
  expect(sink.settled).toBe(false);
  sink.dispose();
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
  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MAX_POLL_MS * 2);
  gone = true;
  await vi.advanceTimersByTimeAsync(PRESETTLED_GONE_MS / 2);
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
