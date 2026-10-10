import {
  type BrowserHandoffCardModel,
  browserHandoffCards,
} from "@houston/sdk/browser-handoff";
import type { FeedItem, HostCard } from "@houston-ai/chat";

const BROWSER_HANDOFF_CARD = "browser_handoff";

/** What a hand-off card row carries: the SDK's model plus the chat it is in,
 *  because a system row reaches its renderer without its conversation. */
export interface BrowserHandoffCardPayload extends BrowserHandoffCardModel {
  conversationId: string;
}

/** The hand-off a host card row carries, or null for any other row. Only
 *  {@link withBrowserHandoffCards} builds these rows, so the payload is its own. */
export function browserHandoffCard(
  card: HostCard,
): BrowserHandoffCardPayload | null {
  return card.kind === BROWSER_HANDOFF_CARD
    ? (card.payload as BrowserHandoffCardPayload)
    : null;
}

/**
 * The chat's feed with a card after every browser hand-off: after the tool's
 * result once it has one, else right after the call. While the hand-off waits
 * the card owns the turn's progress, so no thinking line sits under it.
 */
export function withBrowserHandoffCards(
  items: readonly FeedItem[],
  turnRunning: boolean,
  conversationId: string,
): FeedItem[] {
  const cards = browserHandoffCards(items, turnRunning);
  if (cards.length === 0) return [...items];
  const after = new Map<number, BrowserHandoffCardModel[]>();
  for (const card of cards) {
    const list = after.get(card.anchorIndex) ?? [];
    list.push(card);
    after.set(card.anchorIndex, list);
  }
  const out: FeedItem[] = [];
  items.forEach((item, index) => {
    out.push(item);
    for (const card of after.get(index) ?? []) {
      const payload: BrowserHandoffCardPayload = { ...card, conversationId };
      out.push({
        feed_type: "host_card",
        id: card.key,
        data: {
          kind: BROWSER_HANDOFF_CARD,
          payload,
          ...(card.state === "waiting" ? { ownsProgress: true } : {}),
        },
      });
    }
  });
  return out;
}
