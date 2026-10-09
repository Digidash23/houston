import type { ChatMessage } from "@houston/runtime-client";
import { adoptReply } from "./adopt-reply";
import { conclusiveReply, turnReply } from "./conclusive-reply";
import { TURN_DIED_MESSAGE } from "./turn-errors";
import { finishErr, finishOk, push, type TurnState } from "./turn-settle";

export { TURN_DIED_MESSAGE } from "./turn-errors";

/**
 * Settling a turn whose terminal frame was LOST — the reconnect resynced and
 * the turn is over, so persisted history (complete once a turn ends) is the
 * settle source. The live-frame settles live in turn-settle.ts.
 */

/**
 * Settle a turn whose terminal frame was lost. With a known `turnId` the
 * settle is exact: adopt the assistant message that concludes THIS TURN
 * (text/usage/providerError, see `turnReply`); no such message means the turn died before
 * persisting a reply — an error surface with the server's own dead-turn
 * copy, NEVER an empty "completed" render.
 *
 * Without a turn id, a history that carries ids yields one from our own user
 * row; a legacy history falls back to the trailing assistant message gated by
 * `guard` — a heuristic with a known weakness: turn mode matches the newest
 * user message against the prompt, so two identical prompts in a row can
 * adopt the PREVIOUS turn's reply (see `conclusiveReply`). When nothing
 * concludes the turn, the streamed accumulation is all there is: settle it as
 * completed when text was streamed, else as the dead-turn error.
 */
export function settleFromHistory(
  s: TurnState,
  messages: ChatMessage[] | null,
  turnId: string | undefined,
  guard: (messages: ChatMessage[]) => boolean,
  onAdoptTurnId?: (turnId: string) => void,
): void {
  if (messages && turnId) {
    const reply = turnReply(messages, turnId);
    if (reply) {
      adoptReply(s, reply, onAdoptTurnId);
      return;
    }
    finishErr(s, TURN_DIED_MESSAGE);
    return;
  }
  if (messages) {
    // No turn id: derived from our user row when the history carries ids,
    // else the legacy trailing reply + guard (conclusive-reply.ts).
    const reply = conclusiveReply(messages, undefined, guard);
    if (reply) {
      adoptReply(s, reply, onAdoptTurnId);
      return;
    }
  }
  // History reload failed, or nothing in it concludes our turn: the streamed
  // accumulation is all there is.
  if (s.text) finishOk(s);
  else finishErr(s, TURN_DIED_MESSAGE);
}

/**
 * The PRE-SETTLED poll's settle source: a turn that finished BEFORE our
 * subscription's first sync (no frames ever replayed, only a fresh idle sync).
 * Unlike {@link settleFromHistory} — which is entered on a CONFIRMED
 * lost-terminal (a boundary / resync) and therefore falls through to
 * `finishErr(TURN_DIED)` when it finds no reply — this settle is SPECULATIVE:
 * a fresh idle sync in turn mode is ALSO the normal "turn we're about to
 * trigger" shape, so a turn that simply hasn't produced its reply yet must NOT
 * be errored. It settles ONLY on conclusive proof the turn is over — a reply
 * for our exact `turnId`, or (legacy, no ids) a trailing assistant message the
 * `guard` accepts as ours — and returns `true` iff it did. Inconclusive (a
 * trailing USER message, a guard reject, a failed reload, or live evidence that
 * arrived mid-reload) returns `false` and settles nothing: the poll re-arms and
 * the stream stays the authority.
 */
export async function presettleFromHistory(
  s: TurnState,
  reloadHistory: () => Promise<ChatMessage[]>,
  turnId: string | undefined,
  guard: (messages: ChatMessage[]) => boolean,
  hasEvidence: () => boolean,
  onAdoptTurnId?: (turnId: string) => void,
): Promise<boolean> {
  let messages: ChatMessage[];
  try {
    messages = await reloadHistory();
  } catch {
    // A speculative background reload — swallow and re-arm, never surface noise
    // on every poll tick. A genuinely lost stream is owned by the reconnect
    // budget, which settles the turn on its own.
    return false;
  }
  // Live evidence landed while we were reloading, or another path already
  // settled: the stream now owns the turn — never settle from a stale poll.
  if (s.settled || hasEvidence()) return false;
  const reply = conclusiveReply(messages, turnId, guard);
  if (!reply) return false;
  adoptReply(s, reply, onAdoptTurnId);
  return true;
}

/**
 * Refetch history and settle from it (`settleFromHistory`), then stop the
 * subscription. A failed reload surfaces as a system message (no silent
 * fallback) and the settle proceeds from the streamed accumulation — the UI
 * must never hang.
 */
export async function reloadAndSettle(
  s: TurnState,
  reloadHistory: () => Promise<ChatMessage[]>,
  turnId: string | undefined,
  guard: (messages: ChatMessage[]) => boolean,
  stop: () => void,
  onAdoptTurnId?: (turnId: string) => void,
  /** False once the turn may no longer settle this way (a Stop muted it). */
  live: () => boolean = () => true,
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
  if (!live()) return;
  if (!s.settled) settleFromHistory(s, messages, turnId, guard, onAdoptTurnId);
  stop();
}
