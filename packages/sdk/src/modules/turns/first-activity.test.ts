import type {
  EventStreamOptions,
  HoustonEngineClient,
  WireFrame,
} from "@houston/runtime-client";
import { afterEach, expect, test, vi } from "vitest";
import type { FeedOutput } from "./feed-output";
import {
  type FirstResponse,
  FirstResponseClock,
  isVisibleActivity,
} from "./first-response";
import { StreamRegistry, type StreamTuning } from "./stream-registry";
import { streamTurn } from "./turn-stream";

/**
 * A turn's FIRST ACTIVITY: the first visible item of any kind (thinking, a
 * tool call, or text), carried on the turn's one first-response report. It is
 * the "is it alive" time: a turn that runs tools before it writes shows the
 * person it is working long before its first text.
 */

const registry = new StreamRegistry();
afterEach(() => {
  registry.disposeAll();
  vi.useRealTimers();
});

const fast: StreamTuning = {
  idleTimeoutMs: 2_000,
  backoff: { initialMs: 1, maxMs: 2, jitter: () => 0 },
};

/** Each step moves the wall clock to `at`, then delivers `frame`. */
type Step = { at: number; frame: WireFrame };

/** One sent turn on conversation `a`, its frames delivered on a fake clock. */
async function timedTurn(steps: Step[]): Promise<FirstResponse[]> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  const engine = {
    async streamEvents(_id: string, o: EventStreamOptions) {
      o.onEvent({
        type: "sync",
        data: { running: false, partial: "", seq: 0 },
      });
      for (const step of steps) {
        vi.setSystemTime(step.at);
        o.onEvent(step.frame);
      }
    },
    async sendMessage() {},
    async getHistory() {
      return { id: "a", title: "", messages: [] };
    },
  } as unknown as HoustonEngineClient;
  const reports: FirstResponse[] = [];
  const output: FeedOutput = {
    pushFeedItem: () => {},
    sessionStatus: () => {},
    persistBoardStatus: async () => {},
    firstResponse: (_a, _s, response) => reports.push(response),
  };
  await streamTurn(engine, "Ag", "a", "hi", output, registry, {
    tuning: fast,
  });
  return reports;
}

const tool = (name: string): WireFrame =>
  ({ type: "tool_start", data: { name, args: {} } }) as WireFrame;
const toolEnd = (name: string): WireFrame =>
  ({
    type: "tool_end",
    data: { name, content: "ok", isError: false },
  }) as WireFrame;
const text = (data: string): WireFrame => ({ type: "text", data });
const done: WireFrame = { type: "done", data: null };

test("a tool call before any text is the first activity; the text stays the first response", async () => {
  const reports = await timedTurn([
    { at: 1_002_000, frame: tool("integration_search") },
    { at: 1_003_000, frame: toolEnd("integration_search") },
    { at: 1_020_000, frame: text("Here is what I found") },
    { at: 1_021_000, frame: done },
  ]);
  expect(reports).toEqual([
    {
      outcome: "first_text",
      sentAt: 1_000_000,
      at: 1_020_000,
      firstActivityAt: 1_002_000,
    },
  ]);
});

test("thinking counts as activity, blank thinking does not", async () => {
  const reports = await timedTurn([
    { at: 1_001_000, frame: { type: "thinking", data: "  " } as WireFrame },
    { at: 1_004_000, frame: { type: "thinking", data: "Plan" } as WireFrame },
    { at: 1_009_000, frame: text("Sure") },
    { at: 1_009_500, frame: done },
  ]);
  expect(reports[0]).toMatchObject({
    outcome: "first_text",
    at: 1_009_000,
    firstActivityAt: 1_004_000,
  });
});

test("text as the first item makes first activity and first text the same moment", async () => {
  const reports = await timedTurn([
    { at: 1_003_000, frame: text("Hi") },
    { at: 1_004_000, frame: done },
  ]);
  expect(reports[0]).toMatchObject({
    at: 1_003_000,
    firstActivityAt: 1_003_000,
  });
});

test("a tools-only turn still reports when it first showed activity", async () => {
  const reports = await timedTurn([
    { at: 1_005_000, frame: tool("bash") },
    { at: 1_006_000, frame: toolEnd("bash") },
    { at: 1_007_000, frame: done },
  ]);
  expect(reports[0]).toMatchObject({
    outcome: "no_text",
    firstActivityAt: 1_005_000,
  });
});

test("a turn that fails before showing anything carries no first activity", async () => {
  const reports = await timedTurn([
    {
      at: 1_001_000,
      frame: { type: "error", data: { message: "The model is overloaded" } },
    },
  ]);
  expect(reports).toHaveLength(1);
  expect(reports[0]?.outcome).toBe("error");
  expect(reports[0]).not.toHaveProperty("firstActivityAt");
});

test("the clock stamps only the first activity, and nothing after its report", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(5_000);
  const reports: FirstResponse[] = [];
  const clock = new FirstResponseClock((r) => reports.push(r));
  vi.setSystemTime(6_000);
  clock.pushed({ feed_type: "user_message", data: "hi" });
  clock.pushed({ feed_type: "tool_call", data: { name: "read", input: {} } });
  vi.setSystemTime(7_000);
  clock.pushed({ feed_type: "thinking_streaming", data: "more" });
  vi.setSystemTime(8_000);
  clock.pushed({ feed_type: "assistant_text_streaming", data: "Done" });
  clock.pushed({ feed_type: "assistant_text", data: "Done again" });
  expect(reports).toEqual([
    { outcome: "first_text", sentAt: 5_000, at: 8_000, firstActivityAt: 6_000 },
  ]);
});

test("only thinking, tool calls and visible text are activity", () => {
  const visible = [
    { feed_type: "tool_call", data: { name: "x", input: {} } },
    { feed_type: "thinking_streaming", data: "a" },
    { feed_type: "thinking", data: "a" },
    { feed_type: "assistant_text_streaming", data: "a" },
    { feed_type: "assistant_text", data: "a" },
  ];
  const invisible = [
    { feed_type: "user_message", data: "hi" },
    { feed_type: "tool_result", data: { name: "x", content: "" } },
    { feed_type: "thinking_streaming", data: "\n" },
    { feed_type: "assistant_text_streaming", data: " " },
    { feed_type: "system_message", data: "Reconnecting" },
    { feed_type: "final_result", data: { result: "" } },
  ];
  expect(visible.map(isVisibleActivity)).toEqual(visible.map(() => true));
  expect(invisible.map(isVisibleActivity)).toEqual(invisible.map(() => false));
});
