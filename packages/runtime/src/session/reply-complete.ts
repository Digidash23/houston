import type { WireEvent } from "@houston/runtime-client";
import type { HarnessSession } from "../backends/types";
import type { TurnFinishMarks } from "./turn-finish";

/**
 * Emit the turn's `reply_complete` frame the moment its finish marks call the
 * reply complete (`TurnFinishMarks.noteReplyBeat`): the client hands the
 * card back to the user then, not after the offers, the durability write and
 * the title that still precede `done`. Shared by both turn executors
 * (session/exec-turn.ts, turn/turn-session-frames.ts) so the frame is decided
 * in one place. Returns the unsubscribe; undefined for a backend without
 * reply beats, which then never emits the frame.
 */
export function emitReplyComplete(
  session: HarnessSession,
  finish: TurnFinishMarks,
  emit: (wire: WireEvent) => void,
): (() => void) | undefined {
  return session.subscribeReplyBeats?.((beat) => {
    if (finish.noteReplyBeat(beat))
      emit({ type: "reply_complete", data: null });
  });
}

/**
 * Feed the turn's finish marks from `session`: every assistant message start
 * (then `onMessageStart`), and the reply beats that decide `reply_complete`
 * (see {@link emitReplyComplete}). Returns one unsubscribe for both.
 */
export function subscribeFinishMarks(
  session: HarnessSession,
  finish: TurnFinishMarks,
  emit: (wire: WireEvent) => void,
  onMessageStart?: () => void,
): () => void {
  const unsubStart = session.subscribeAssistantMessageStart?.(() => {
    finish.noteAssistantMessageStart();
    onMessageStart?.();
  });
  const unsubBeats = emitReplyComplete(session, finish, emit);
  return () => {
    unsubStart?.();
    unsubBeats?.();
  };
}
