/**
 * Where each hand-off card sits in the chat, the same while its turn runs as
 * after it settles. A card goes right after the hand-off (its result once it
 * has one, else its call). The live fold keeps a turn's whole reply in ONE
 * entry, placed where its first words streamed, often above the hand-off; the
 * settled transcript puts the reply after the turn's tools. So a reply of the
 * card's turn found before the card moves after that turn's last tool row,
 * where the settled transcript will have it, and the card never jumps across
 * the reply when the turn ends. A moved reply's row says `settled`: drawn as
 * finished text, never as the chat's streaming tail. It is the chat's last
 * row but not the feed's live edge, which is the newest tool row: while the
 * card waits the turn is blocked on the person and the card owns the
 * progress, and once the person hands back the chat shows its usual in-flight
 * indicator while the agent works, as it would without a card.
 *
 * Published as `@houston/sdk/browser-handoff` (with the card model) so the
 * app's pure feed mapping imports it without the SDK barrel.
 */

import type { BrowserHandoffFeedItem } from "./handoff-calls";
import {
  type BrowserHandoffCardModel,
  browserHandoffCards,
} from "./handoff-card";

export * from "./handoff-card";

/** One row of the chat in display order: a feed item (by index) or a card. */
export type BrowserHandoffFeedRow =
  | {
      kind: "item";
      index: number;
      /** Draw this streaming reply as finished: it was moved under a card,
       *  so it is not where the turn's output lands. */
      settled?: true;
    }
  | { kind: "card"; card: BrowserHandoffCardModel };

const REPLY = new Set(["assistant_text", "assistant_text_streaming"]);
const TOOL_ROW = new Set(["tool_call", "tool_result"]);
/** A stop or restart notice ends a turn as surely as its final result. */
const TURN_EDGE = new Set(["user_message", "final_result", "system_message"]);

/**
 * Whether two rows are provably of one turn: both name the same turn, or
 * neither names one (a transcript from before turn ids, where only the turn
 * edges divide it). One naming a turn and the other not is never enough.
 */
function sameTurn(
  a: BrowserHandoffFeedItem,
  b: BrowserHandoffFeedItem,
): boolean {
  return a.turnId === b.turnId;
}

/** The reply of `anchor`'s turn sitting before it, if any. */
function replyBefore(
  items: readonly BrowserHandoffFeedItem[],
  anchor: number,
): number | null {
  for (let i = anchor - 1; i >= 0; i--) {
    const item = items[i];
    if (TURN_EDGE.has(item.feed_type)) return null;
    // A row of another turn: the anchor's turn started after it.
    if (item.turnId !== undefined && !sameTurn(item, items[anchor]))
      return null;
    if (REPLY.has(item.feed_type) && sameTurn(item, items[anchor])) return i;
  }
  return null;
}

/** The last tool row of `anchor`'s turn, at or after the anchor. */
function lastToolRow(
  items: readonly BrowserHandoffFeedItem[],
  anchor: number,
): number {
  let last = anchor;
  for (let i = anchor + 1; i < items.length; i++) {
    const item = items[i];
    if (TURN_EDGE.has(item.feed_type) || !sameTurn(item, items[anchor])) break;
    if (TOOL_ROW.has(item.feed_type)) last = i;
  }
  return last;
}

/**
 * The feed with its hand-off cards, in display order. Every feed item appears
 * exactly once; after an item come its cards, then any reply moved there.
 */
export function browserHandoffFeedRows(
  items: readonly BrowserHandoffFeedItem[],
  turnRunning: boolean,
): BrowserHandoffFeedRow[] {
  const cards = browserHandoffCards(items, turnRunning);
  const cardsAfter = new Map<number, BrowserHandoffCardModel[]>();
  /** Reply index -> the item it now follows. */
  const moved = new Map<number, number>();
  for (const card of cards) {
    const list = cardsAfter.get(card.anchorIndex) ?? [];
    list.push(card);
    cardsAfter.set(card.anchorIndex, list);
    const reply = replyBefore(items, card.anchorIndex);
    if (reply === null) continue;
    const after = lastToolRow(items, card.anchorIndex);
    moved.set(reply, Math.max(moved.get(reply) ?? after, after));
  }
  const rows: BrowserHandoffFeedRow[] = [];
  items.forEach((_, index) => {
    if (!moved.has(index)) rows.push({ kind: "item", index });
    for (const card of cardsAfter.get(index) ?? [])
      rows.push({ kind: "card", card });
    for (const [reply, after] of moved)
      if (after === index)
        rows.push({ kind: "item", index: reply, settled: true });
  });
  return rows;
}
