import {
  type ChatMessage,
  encodeAutoContinue,
  encodeHeartbeat,
} from "@houston/protocol";
import { describe, expect, test } from "vitest";
import { briefingTurnState } from "./settle";

const SINCE = 1_000;
const prompt = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  role: "user",
  content: encodeHeartbeat("Brief them."),
  ts: SINCE + 5,
  turnId: "t1",
  ...over,
});
const answer = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  role: "assistant",
  content: "Good morning",
  ts: SINCE + 9,
  turnId: "t1",
  ...over,
});

describe("the pending briefing turn", () => {
  test("is running while the manager is busy, whatever the transcript says", () => {
    expect(briefingTurnState([prompt(), answer()], SINCE, true)).toEqual({
      kind: "running",
    });
  });

  test("completed: the briefing's own turn answered", () => {
    expect(briefingTurnState([prompt(), answer()], SINCE, false)).toEqual({
      kind: "completed",
    });
  });

  test("failed: the turn's last reply carries a provider error", () => {
    const failed = answer({
      content: "",
      providerError: {
        kind: "unknown",
        provider: "anthropic",
        raw_excerpt: "overloaded",
      },
    });
    expect(briefingTurnState([prompt(), failed], SINCE, false)).toEqual({
      kind: "failed",
      reason: "overloaded",
    });
  });

  test("failed: no reply, or the hidden message never landed", () => {
    expect(briefingTurnState([prompt()], SINCE, false)).toMatchObject({
      kind: "failed",
      reason: "the briefing turn ended without a reply",
    });
    expect(briefingTurnState([], SINCE, false)).toMatchObject({
      kind: "failed",
      reason: "the briefing never reached the chat",
    });
  });

  test("ignores an older briefing and other hidden messages", () => {
    const old = [
      prompt({ ts: SINCE - 50, turnId: "t0" }),
      answer({ turnId: "t0" }),
    ];
    const resume = prompt({ content: encodeAutoContinue("continue") });
    expect(briefingTurnState([...old, resume], SINCE, false)).toMatchObject({
      kind: "failed",
      reason: "the briefing never reached the chat",
    });
  });

  test("a later chat's reply never answers for the briefing", () => {
    const messages = [
      prompt(),
      { role: "user", content: "thanks", ts: SINCE + 20, turnId: "t2" },
      answer({ turnId: "t2", ts: SINCE + 25 }),
    ] as ChatMessage[];
    expect(briefingTurnState(messages, SINCE, false)).toMatchObject({
      kind: "failed",
    });
    // Without turn ids, the reply up to the next user message counts.
    const legacy = [
      prompt({ turnId: undefined }),
      answer({ turnId: undefined }),
      { role: "user", content: "thanks", ts: SINCE + 20 },
    ] as ChatMessage[];
    expect(briefingTurnState(legacy, SINCE, false)).toEqual({
      kind: "completed",
    });
  });
});
