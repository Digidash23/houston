import type { ChatMessage, WireFrame } from "@houston/runtime-client";
import { adoptReply } from "./adopt-reply";
import { turnReply } from "./conclusive-reply";
import { applyTurnFrame } from "./turn-frames";
import { push, type TurnState } from "./turn-settle";

/**
 * Settle a clean end whose reply began before the stream could keep it (the
 * pre-accept buffer overflowed), so the live text is only the reply's tail.
 * Persisted history holds the whole reply. When it does not yet (the read beat
 * the persist) or the reload failed, the end settles from the tail: a clean
 * `done` is never turned into the dead-turn error.
 */
export async function settleOverflowedEnd(
  s: TurnState,
  done: Extract<WireFrame, { type: "done" }>,
  turnId: string,
  reloadHistory: () => Promise<ChatMessage[]>,
  stop: () => void,
  live: () => boolean,
): Promise<void> {
  let messages: ChatMessage[] | null = null;
  try {
    messages = await reloadHistory();
  } catch (e) {
    if (!live()) return;
    push(s, {
      feed_type: "system_message",
      data: `Couldn't reload the conversation: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  if (!live() || s.settled) return;
  const reply = messages ? turnReply(messages, turnId) : undefined;
  if (!reply) {
    applyTurnFrame(s, done, stop);
    return;
  }
  if (done.pendingInteraction) s.pendingInteraction = done.pendingInteraction;
  adoptReply(s, reply);
  stop();
}
