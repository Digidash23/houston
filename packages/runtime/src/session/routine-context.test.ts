import type { ChatMessage, ProviderError } from "@houston/runtime-client";
import { expect, test } from "vitest";
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
  expect(planRoutineContext(ROUTINE, messages, "now", 200_000)).toEqual({
    reset: false,
  });
});

test("a routine chat at its carry line resets, measured with the last reply", () => {
  const messages = [...run("r1", used(99_600, 400)), current()];
  expect(planRoutineContext(ROUTINE, messages, "now", 200_000)).toEqual({
    reset: true,
    carriedTokens: 100_000,
    windowTokens: 200_000,
  });
});

test("an ordinary chat never resets, however full", () => {
  const messages = [...run("r1", used(190_000)), current()];
  expect(planRoutineContext("chat-1", messages, "now", 200_000)).toEqual({
    reset: false,
  });
});

test("a run that overflowed resets the next one, sized by the window it named", () => {
  const messages = [
    ...run("r1", used(20_000)),
    ...run("r2", { content: "", providerError: overflow(128_000) }),
    current(),
  ];
  const plan = planRoutineContext(ROUTINE, messages, "now", 1_000_000);
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
  const plan = planRoutineContext(ROUTINE, messages, "now", 200_000);
  expect(plan).toMatchObject({ reset: true });
  expect(plan.reset && plan.carriedTokens).toBeGreaterThan(100_000);
});

test("a provider that reports no usage is measured by the transcript itself", () => {
  const messages = [
    ...run("r1", { content: "y".repeat(80_000) }),
    ...run("r2", { content: "y".repeat(80_000) }),
    current(),
  ];
  expect(planRoutineContext(ROUTINE, messages, "now", 64_000)).toMatchObject({
    reset: true,
  });
  expect(planRoutineContext(ROUTINE, messages, "now", 1_000_000)).toEqual({
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
  expect(planRoutineContext(ROUTINE, messages, "now", 64_000)).toMatchObject({
    reset: true,
  });
});

test("CJK runs without usage are not undercounted at four characters a token", () => {
  const messages = [
    ...run("r1", { content: "請求書の確認が完了しました。".repeat(700) }),
    current(),
  ];
  // ~9.8k characters: 2.5k tokens at 4 chars a token, ~9.8k as CJK really is.
  expect(planRoutineContext(ROUTINE, messages, "now", 16_384)).toMatchObject({
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
  expect(planRoutineContext(ROUTINE, messages, "now", 200_000)).toEqual({
    reset: false,
  });
});

test("the walk stops at a /clear: the cleared turns are not in context", () => {
  const messages: ChatMessage[] = [
    ...run("r1", used(190_000)),
    { role: "assistant", content: "", ts: 2, contextCleared: true },
    current(),
  ];
  expect(planRoutineContext(ROUTINE, messages, "now", 200_000)).toEqual({
    reset: false,
  });
});
