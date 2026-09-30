import type { ChatMessage } from "@houston/runtime-client";
import { expect, test } from "vitest";
import { routineCarryLine } from "./routine-context";
import {
  renderRoutineReplay,
  replayForConversation,
  routineReplayTokenBudget,
} from "./routine-replay";
import { estimateTokens } from "./token-estimate";

const PROMPT =
  'This automation "Digest" is running right now.\n\n---\nSummarize the new support tickets.';

function runs(count: number, reply: (n: number) => string): ChatMessage[] {
  return Array.from({ length: count }, (_, n) => [
    {
      role: "user" as const,
      content: PROMPT,
      ts: Date.UTC(2026, 8, 1 + n, 7),
      turnId: `r${n}`,
    },
    {
      role: "assistant" as const,
      content: reply(n),
      ts: Date.UTC(2026, 8, 1 + n, 7, 1),
      turnId: `r${n}`,
    },
  ]).flat();
}

test("the routine replay budget is 15% of the window, capped at 24k tokens", () => {
  expect(routineReplayTokenBudget(32_000)).toBe(4_800);
  expect(routineReplayTokenBudget(200_000)).toBe(24_000);
  expect(routineReplayTokenBudget(1_000_000)).toBe(24_000);
});

test("a fresh run's replay always lands well below the carry line", () => {
  for (const window of [8_192, 32_768, 128_000, 200_000, 1_000_000])
    expect(routineReplayTokenBudget(window)).toBeLessThanOrEqual(
      routineCarryLine(window) * 0.3,
    );
});

test("a CJK-heavy routine replay stays within its token budget", () => {
  const messages = runs(
    300,
    (n) => `第${n}回: ${"請求書の確認が完了しました。".repeat(20)}`,
  );
  const budget = routineReplayTokenBudget(32_768);
  const replay = renderRoutineReplay(messages, "now", PROMPT, budget);

  expect(replay?.truncated).toBe(true);
  expect(replay?.text).toContain("第299回");
  // The header and footer ride on top of the transcript budget.
  expect(estimateTokens(replay?.text ?? "")).toBeLessThan(budget + 300);
});

test("a log-heavy routine replay stays within its token budget", () => {
  const messages = runs(
    300,
    (n) =>
      `run ${n}: ${"2026-09-30T10:31:57Z GET /v1/x?id=0x7f3e 200 12ms; ".repeat(40)}`,
  );
  const budget = routineReplayTokenBudget(32_768);
  const replay = renderRoutineReplay(messages, "now", PROMPT, budget);
  expect(replay?.text).toContain("run 299:");
  expect(estimateTokens(replay?.text ?? "")).toBeLessThan(budget + 300);
});

test("earlier runs' instructions collapse to one dated line", () => {
  const messages = runs(3, (n) => `Run ${n}: 2 new tickets.`);
  const replay = renderRoutineReplay(messages, "now", PROMPT, 25_000);

  expect(replay?.text).toContain("This automation has run before");
  expect(replay?.text).not.toContain("Summarize the new support tickets");
  expect(replay?.text).toContain(
    "User: [Earlier run of this automation at 2026-09-01T07:00:00.000Z, same instructions as this run]",
  );
  expect(replay?.text).toContain("Assistant: Run 2: 2 new tickets.");
  expect(replay?.truncated).toBe(false);
});

test("instructions that changed since are replayed as they were", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "Old instructions.", ts: 1, turnId: "r0" },
    { role: "assistant", content: "Did the old thing.", ts: 2, turnId: "r0" },
  ];
  const replay = renderRoutineReplay(messages, "now", PROMPT, 2_500);
  expect(replay?.text).toContain("User: Old instructions.");
});

test("the replay keeps the newest runs within its budget", () => {
  const messages = runs(200, (n) => `Run ${n}: ${"ticket ".repeat(100)}`);
  const budget = 5_000;
  const replay = renderRoutineReplay(messages, "now", PROMPT, budget);

  expect(replay?.truncated).toBe(true);
  expect(replay?.text).toContain("Run 199:");
  expect(replay?.text).not.toContain("Run 0:");
  // The header, note and footer ride on top of the transcript budget.
  expect(estimateTokens(replay?.text ?? "")).toBeLessThan(budget + 300);
});

test("a routine chat's replay is bounded by the routine budget for any rebuild", () => {
  const messages = runs(400, (n) => `Run ${n}: ${"ticket ".repeat(200)}`);
  const replay = replayForConversation({
    conversationId: "routine-digest",
    messages,
    currentTurnId: "now",
    currentPrompt: PROMPT,
    windowTokens: 1_000_000,
    reason: "reset",
  });
  expect(estimateTokens(replay?.text ?? "")).toBeLessThan(
    routineReplayTokenBudget(1_000_000) + 300,
  );
});

test("an ordinary chat's replay is exactly the one it always had", () => {
  const messages = runs(2, (n) => `Reply ${n}`);
  const replay = replayForConversation({
    conversationId: "chat-1",
    messages,
    currentTurnId: "now",
    currentPrompt: "Next question",
    windowTokens: 200_000,
    reason: "reset",
  });
  expect(replay?.text).toContain("[Continuing an existing conversation.");
  expect(replay?.text).toContain("Summarize the new support tickets");
  expect(replay?.text).not.toContain("This automation has run before");
});
