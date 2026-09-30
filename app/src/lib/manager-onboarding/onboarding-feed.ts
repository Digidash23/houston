// `.ts` extensions so the node test runner can import this module directly.
import type { FeedItem, HostCard } from "@houston-ai/chat";
import { type GoalProgress, goalProgress } from "./goal-progress.ts";
import {
  decodeGoalCard,
  decodeTeamCard,
  type TeamCardPayload,
} from "./onboarding-card-markers.ts";

const ONBOARDING_CARD = "onboarding";

/** A card the AI Manager's chat draws for onboarding. */
export type OnboardingCard =
  | { kind: "team"; team: TeamCardPayload }
  | { kind: "goal"; goal: string; progress: GoalProgress };

/** The onboarding card a host card row carries, or null for any other row.
 *  Only {@link cardItem} builds these rows, so the payload is its own. */
export function onboardingCard(card: HostCard): OnboardingCard | null {
  return card.kind === ONBOARDING_CARD
    ? (card.payload as OnboardingCard)
    : null;
}

function cardItem(id: string | undefined, card: OnboardingCard): FeedItem {
  return {
    feed_type: "host_card",
    ...(id ? { id } : {}),
    // The goal card shows how the goal is going, so no thinking line
    // repeats it while the manager works.
    data: {
      kind: ONBOARDING_CARD,
      payload: card,
      ...(card.kind === "goal" ? { ownsProgress: true } : {}),
    },
  };
}

/** The scripted conversation's closing, as the same row the real chat shows. */
export function teamCardItem(key: string, team: TeamCardPayload): FeedItem {
  return cardItem(key, { kind: "team", team });
}

/** What of the goal's turn still shows under its card: the invisible settle
 *  frame, a provider failure (a card the person can act on), and the chat's
 *  own lines about the turn (why it stopped, a restart). */
function keptUnderGoalCard(item: FeedItem): boolean {
  return (
    item.feed_type === "final_result" ||
    item.feed_type === "provider_error" ||
    item.feed_type === "system_message"
  );
}

/**
 * The AI Manager's feed with onboarding drawn as cards: the closing message
 * becomes the team card, and the message that starts the person's goal
 * becomes the goal card, which stands in for it and for the whole turn it
 * started (the manager's words and tool rows). A goal started again (Try
 * again) replaces the earlier attempt, so the chat shows one goal card, the
 * latest.
 */
export function withOnboardingCards(items: readonly FeedItem[]): FeedItem[] {
  const lastKickoff = items.findLastIndex(
    (item) =>
      item.feed_type === "user_message" && decodeGoalCard(item.data) !== null,
  );
  const out: FeedItem[] = [];
  let at = 0;
  while (at < items.length) {
    const item = items[at];
    const team =
      item.feed_type === "assistant_text" ? decodeTeamCard(item.data) : null;
    const kickoff =
      item.feed_type === "user_message" ? decodeGoalCard(item.data) : null;
    if (team) out.push(cardItem(item.id, { kind: "team", team }));
    if (!kickoff) {
      if (!team) out.push(item);
      at += 1;
      continue;
    }
    // The turn runs until the person's next message, which also ends it.
    const next = items.findIndex(
      (later, index) => index > at && later.feed_type === "user_message",
    );
    const stop = next < 0 ? items.length : next;
    const turn = items.slice(at + 1, stop);
    if (at === lastKickoff) {
      const seen = next < 0 ? turn : [...turn, items[next]];
      out.push(
        cardItem(item.id, {
          kind: "goal",
          goal: kickoff.goal,
          progress: goalProgress(seen),
        }),
        ...turn.filter(keptUnderGoalCard),
      );
    }
    at = stop;
  }
  return out;
}
