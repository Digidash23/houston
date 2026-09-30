import type { ChatMessage } from "@houston/runtime-client";

/**
 * Which persisted record CONCLUDES a turn, for the settles that read history
 * instead of the live terminal frame (settle-from-history.ts).
 */

/**
 * The record that concludes turn `turnId`: the LAST assistant message
 * persisted under its id. A turn can persist more than one. A compaction
 * before its prompt claims the summary marker it wrote (so the divider sits
 * where the context restarted), and the turn's own reply or failure card
 * follows it; an adopted re-run of a turn appends its pair behind the dead
 * attempt's. A marker still carrying the `native` trigger was never claimed
 * by a finished turn, so it concludes nothing. A plain loop: the SDK targets
 * ES2022, without `findLast`.
 */
export function turnReply(
  messages: readonly ChatMessage[],
  turnId: string,
): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m?.role === "assistant" &&
      m.turnId === turnId &&
      m.compaction?.trigger !== "native"
    )
      return m;
  }
  return undefined;
}

/**
 * The one message that PROVES the turn is over, or null (inconclusive).
 *
 * - With a `turnId`: the record that concludes that turn.
 * - Without one, on a history that carries turn ids: the trailing message
 *   proves nothing, since a native compaction writes its summary marker
 *   mid-turn, before the reply exists. The id is derived from our own user
 *   row (the newest, which the `guard` must accept as ours), and only a
 *   later record under it concludes the turn.
 * - On a legacy history with no turn ids at all: the trailing message must be
 *   an assistant reply the `guard` accepts as ours.
 */
export function conclusiveReply(
  messages: readonly ChatMessage[],
  turnId: string | undefined,
  guard: (messages: ChatMessage[]) => boolean,
): ChatMessage | null {
  if (turnId) return turnReply(messages, turnId) ?? null;
  const all = [...messages];
  if (all.some((m) => m.turnId !== undefined)) {
    if (!guard(all)) return null;
    let at = all.length - 1;
    while (at >= 0 && all[at]?.role !== "user") at--;
    const own = all[at]?.turnId;
    return own ? (turnReply(all.slice(at + 1), own) ?? null) : null;
  }
  const last = all[all.length - 1];
  return last?.role === "assistant" && guard(all) ? last : null;
}
