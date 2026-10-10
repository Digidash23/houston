import type { WireEvent } from "@houston/runtime-client";
import { expect, test } from "vitest";
import type { HarnessSession, ReplyBeat } from "../backends/types";
import { emitReplyComplete, subscribeFinishMarks } from "./reply-complete";
import { TurnFinishMarks } from "./turn-finish";

function beatSession() {
  let listener: ((beat: ReplyBeat) => void) | undefined;
  const session = {
    subscribeReplyBeats: (l: (beat: ReplyBeat) => void) => {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
  } as unknown as HarnessSession;
  return { session, beat: (b: ReplyBeat) => listener?.(b) };
}

test("emits reply_complete once, when the finish marks complete the reply", () => {
  const { session, beat } = beatSession();
  const finish = new TurnFinishMarks();
  const frames: WireEvent[] = [];
  const unsub = emitReplyComplete(session, finish, (w) => frames.push(w));

  finish.noteAssistantMessageStart();
  beat({ type: "tool_call_start", name: "suggest_actions" });
  expect(frames).toEqual([]);
  finish.noteAssistantMessageStart();
  finish.noteAssistantText("Done.");
  beat({ type: "tool_call_start", name: "suggest_actions" });
  beat({ type: "answer_end" });
  expect(frames).toEqual([{ type: "reply_complete", data: null }]);

  unsub?.();
  beat({ type: "answer_end" });
  expect(frames).toHaveLength(1);
});

test("a backend without reply beats never emits the frame", () => {
  const unsub = emitReplyComplete(
    {} as HarnessSession,
    new TurnFinishMarks(),
    () => {
      throw new Error("must not emit");
    },
  );
  expect(unsub).toBeUndefined();
});

test("subscribeFinishMarks feeds message starts and reply beats, one unsubscribe for both", () => {
  let start: (() => void) | undefined;
  let beat: ((b: ReplyBeat) => void) | undefined;
  const session = {
    subscribeAssistantMessageStart: (l: () => void) => {
      start = l;
      return () => {
        start = undefined;
      };
    },
    subscribeReplyBeats: (l: (b: ReplyBeat) => void) => {
      beat = l;
      return () => {
        beat = undefined;
      };
    },
  } as unknown as HarnessSession;
  const finish = new TurnFinishMarks();
  const frames: WireEvent[] = [];
  let starts = 0;
  const unsub = subscribeFinishMarks(
    session,
    finish,
    (w) => frames.push(w),
    () => starts++,
  );

  start?.();
  finish.noteAssistantText("Done.");
  beat?.({ type: "answer_end" });
  expect(starts).toBe(1);
  expect(frames).toEqual([{ type: "reply_complete", data: null }]);

  unsub();
  expect(start).toBeUndefined();
  expect(beat).toBeUndefined();
});
