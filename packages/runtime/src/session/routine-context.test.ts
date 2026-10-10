import type { ChatMessage, ProviderError } from "@houston/runtime-client";
import { expect, test } from "vitest";
import { carryAfterRun } from "./routine-carry";
import {
  isRoutineConversation,
  planRoutineContext,
  routineCarryLine,
} from "./routine-context";

const ROUTINE = "routine-daily-digest";

function run(
  turnId: string,
  assistant: Partial<ChatMessage> = {},
  prompt = "Run the digest.",
): ChatMessage[] {
  return [
    { role: "user", content: prompt, ts: 1, turnId },
    { role: "assistant", content: "Done.", ts: 2, turnId, ...assistant },
  ];
}

const used = (context_tokens: number, output_tokens = 0) => ({
  usage: { context_tokens, output_tokens, cached_tokens: 0 },
});

const overflow = (window: number | null): ProviderError => ({
  kind: "context_overflow",
  provider: "anthropic",
  model: "claude-opus-5",
  context_window_tokens: window,
  prompt_tokens: null,
  message: "prompt is too long",
});

/** The current run's own user message, already recorded before the plan. */
const current = (): ChatMessage => ({
  role: "user",
  content: "Run the digest.",
  ts: 3,
  turnId: "now",
});

test("routine chats are recognised by their conversation id alone", () => {
  expect(isRoutineConversation("routine-abc")).toBe(true);
  expect(isRoutineConversation("routine-abc-run-1")).toBe(true);
  expect(isRoutineConversation("ROUTINE-abc")).toBe(true);
  expect(isRoutineConversation("activity-abc")).toBe(false);
  expect(isRoutineConversation("chat-1")).toBe(false);
});

test("the carry line is half the window, capped at 100k tokens", () => {
  expect(routineCarryLine(32_768)).toBe(16_384);
  expect(routineCarryLine(200_000)).toBe(100_000);
  expect(routineCarryLine(258_400)).toBe(100_000);
  expect(routineCarryLine(1_000_000)).toBe(100_000);
});

test("a routine chat under its carry line keeps its session", () => {
  const messages = [...run("r1", used(99_000, 500)), current()];
  expect(
    planRoutineContext(
      ROUTINE,
      { messages, rotated: false },
      "now",
      200_000,
      "fire",
    ),
  ).toEqual({
    reset: false,
  });
});

test("a routine chat at its carry line resets, measured with the last reply", () => {
  const messages = [...run("r1", used(99_600, 400)), current()];
  expect(
    planRoutineContext(
      ROUTINE,
      { messages, rotated: false },
      "now",
      200_000,
      "fire",
    ),
  ).toEqual({
    reset: true,
    carriedTokens: 100_000,
    windowTokens: 200_000,
  });
});

test("a person chatting in a routine chat is not held to the fire budget", () => {
  // A tool-heavy reply left 106k in a 1M window: a fire resets, a chat turn
  // keeps its session and leaves the rest to the ordinary autocompact.
  const messages = [...run("r1", used(106_000, 300)), current()];
  const transcript = { messages, rotated: false };
  expect(
    planRoutineContext(ROUTINE, transcript, "now", 1_000_000, "chat"),
  ).toEqual({ reset: false });
  expect(
    planRoutineContext(ROUTINE, transcript, "now", 1_000_000, "fire"),
  ).toMatchObject({ reset: true, carriedTokens: 106_300 });
});

test("a chat turn after an overflow, or over an unmeasured history, still resets", () => {
  const overflowed = [
    ...run("r1", { content: "", providerError: overflow(200_000) }),
    current(),
  ];
  expect(
    planRoutineContext(
      ROUTINE,
      { messages: overflowed, rotated: false },
      "now",
      1_000_000,
      "chat",
    ),
  ).toMatchObject({ reset: true, windowTokens: 200_000 });
  expect(
    planRoutineContext(
      ROUTINE,
      { messages: [current()], rotated: true },
      "now",
      1_000_000,
      "chat",
    ),
  ).toMatchObject({ reset: true, carriedTokens: null });
});

test("an ordinary chat never resets, however full", () => {
  const messages = [...run("r1", used(190_000)), current()];
  expect(
    planRoutineContext(
      "chat-1",
      { messages, rotated: false },
      "now",
      200_000,
      "fire",
    ),
  ).toEqual({
    reset: false,
  });
});

test("a run that overflowed resets the next one, sized by the window it named", () => {
  const messages = [
    ...run("r1", used(20_000)),
    ...run("r2", { content: "", providerError: overflow(128_000) }),
    current(),
  ];
  const plan = planRoutineContext(
    ROUTINE,
    { messages, rotated: false },
    "now",
    1_000_000,
    "fire",
  );
  expect(plan).toMatchObject({ reset: true, windowTokens: 128_000 });
});

test("runs newer than the last measurement are added as an estimate", () => {
  // The refused run's result carried zero usage: not a measurement.
  const messages = [
    ...run("r1", used(90_000)),
    ...run("r2", {
      content: "x".repeat(60_000),
      ...used(0),
      providerError: {
        kind: "quota_exhausted",
        provider: "anthropic",
        message: "out of credits",
      } as ProviderError,
    }),
    current(),
  ];
  const plan = planRoutineContext(
    ROUTINE,
    { messages, rotated: false },
    "now",
    200_000,
    "fire",
  );
  expect(plan).toMatchObject({ reset: true });
  expect(plan.reset && plan.carriedTokens).toBeGreaterThan(100_000);
});

test("a provider that reports no usage is measured by the transcript itself", () => {
  const messages = [
    ...run("r1", { content: "y".repeat(80_000) }),
    ...run("r2", { content: "y".repeat(80_000) }),
    current(),
  ];
  expect(
    planRoutineContext(
      ROUTINE,
      { messages, rotated: false },
      "now",
      64_000,
      "fire",
    ),
  ).toMatchObject({
    reset: true,
  });
  expect(
    planRoutineContext(
      ROUTINE,
      { messages, rotated: false },
      "now",
      1_000_000,
      "fire",
    ),
  ).toEqual({
    reset: false,
  });
});

test("thousands of short runs without usage are measured over the whole chat", () => {
  // A local endpoint that reports no usage: 3,000 short messages of ~200
  // characters. The newest 400 alone read as ~20k tokens, under a 64k
  // window's 32k line; the chat as the resumed session holds it is ~150k.
  const messages: ChatMessage[] = [];
  for (let n = 0; n < 1_500; n++)
    messages.push(
      ...run(`r${n}`, { content: "x ".repeat(100) }, "y ".repeat(100)),
    );
  messages.push(current());
  expect(
    planRoutineContext(
      ROUTINE,
      { messages, rotated: false },
      "now",
      64_000,
      "fire",
    ),
  ).toMatchObject({
    reset: true,
  });
});

test("CJK runs without usage are not undercounted at four characters a token", () => {
  const messages = [
    ...run("r1", { content: "請求書の確認が完了しました。".repeat(700) }),
    current(),
  ];
  // ~9.8k characters: 2.5k tokens at 4 chars a token, ~9.8k as CJK really is.
  expect(
    planRoutineContext(
      ROUTINE,
      { messages, rotated: false },
      "now",
      16_384,
      "fire",
    ),
  ).toMatchObject({
    reset: true,
  });
});

test("the walk stops at the last compaction: older fills no longer apply", () => {
  const messages = [
    ...run("r1", used(190_000)),
    // The reset run failed before reporting usage; its boundary still stands.
    ...run("r2", {
      content: "",
      compaction: { trigger: "proactive", pre_tokens: 190_000 },
    }),
    current(),
  ];
  expect(
    planRoutineContext(
      ROUTINE,
      { messages, rotated: false },
      "now",
      200_000,
      "fire",
    ),
  ).toEqual({
    reset: false,
  });
});

test("the walk stops at a /clear: the cleared turns are not in context", () => {
  const messages: ChatMessage[] = [
    ...run("r1", used(190_000)),
    { role: "assistant", content: "", ts: 2, contextCleared: true },
    current(),
  ];
  expect(
    planRoutineContext(
      ROUTINE,
      { messages, rotated: false },
      "now",
      200_000,
      "fire",
    ),
  ).toEqual({
    reset: false,
  });
});

const record = (turnId: string, tokens: number | null, overflowed = false) => ({
  turnId,
  tokens,
  overflowed,
  namedWindow: null,
});

test("the recorded carry of the newest run decides, even with nothing else live", () => {
  // Rotation archived the whole previous run: only this run's row is live.
  const plan = planRoutineContext(
    ROUTINE,
    { messages: [current()], carry: record("r9", 150_000), rotated: true },
    "now",
    200_000,
    "fire",
  );
  expect(plan).toEqual({
    reset: true,
    carriedTokens: 150_000,
    windowTokens: 200_000,
  });
});

test("a recorded overflow of the newest run resets even with nothing else live", () => {
  const plan = planRoutineContext(
    ROUTINE,
    { messages: [current()], carry: record("r9", 20_000, true), rotated: true },
    "now",
    200_000,
    "fire",
  );
  expect(plan).toMatchObject({ reset: true });
});

test("runs newer than the recorded one are estimated on top of it", () => {
  const plan = planRoutineContext(
    ROUTINE,
    {
      messages: [
        ...run("r9", {}),
        ...run("r10", { content: "z ".repeat(40_000) }),
        current(),
      ],
      carry: record("r9", 85_000),
      rotated: false,
    },
    "now",
    200_000,
    "fire",
  );
  expect(plan).toMatchObject({ reset: true });
});

test("a rotated chat with no record and nothing measured live resets", () => {
  expect(
    planRoutineContext(
      ROUTINE,
      { messages: [current()], rotated: true },
      "now",
      200_000,
      "fire",
    ),
  ).toEqual({ reset: true, carriedTokens: null, windowTokens: 200_000 });
});

test("a run that reported usage leaves exactly that carry behind", () => {
  const messages = [...run("r1", used(40_000, 1_000))];
  expect(carryAfterRun({ messages, rotated: false }, "r1")).toEqual({
    turnId: "r1",
    tokens: 41_000,
    overflowed: false,
    namedWindow: null,
  });
});

test("a usage-less run adds its own estimate to the carry before it", () => {
  const messages = [
    ...run("r1", {}),
    ...run("r2", { content: "a ".repeat(4_000) }),
  ];
  const after = carryAfterRun(
    { messages, carry: record("r1", 30_000), rotated: false },
    "r2",
  );
  expect(after.tokens).toBeGreaterThan(32_000);
  expect(after.tokens).toBeLessThan(33_000);
});

test("a usage-less run that reset counts its replay, not the old carry", () => {
  const messages = [
    ...run("r1", {}),
    ...run("r2", {
      content: "ok",
      compaction: { trigger: "proactive", pre_tokens: 150_000 },
    }),
  ];
  const after = carryAfterRun(
    { messages, carry: record("r1", 150_000), rotated: false },
    "r2",
    6_000,
  );
  expect(after.tokens).toBeGreaterThan(6_000);
  expect(after.tokens).toBeLessThan(6_100);
});

test("an overflowed run is recorded as overflowed with the window it named", () => {
  const messages = [
    ...run("r1", { content: "", providerError: overflow(128_000) }),
  ];
  expect(carryAfterRun({ messages, rotated: false }, "r1")).toMatchObject({
    overflowed: true,
    namedWindow: 128_000,
  });
});
