import {
  hasOnlySuggestionSteps,
  parsePendingInteraction,
} from "@houston/protocol";
import type { ChatMessage } from "@houston/runtime-client";

/**
 * WHO may answer a conversation's live card. On a shared agent several members
 * talk to one agent, and a card (a question, an approval, a connect step) is
 * for the person whose message started the turn that raised it. While a card
 * is live, only the person it is for may answer (their next message), dismiss,
 * import into, or truncate the conversation.
 *
 * Pure over the stored messages so every entry point (the standing runtime's
 * routes and queued turns, the pooled turn and the pooled conversation ops)
 * applies the same rule.
 */

/** The refusal code for an answer or dismissal from someone the card is not for. */
export const NOT_INTERACTION_OWNER = "not_interaction_owner";

/** The 403 body every entry point answers with. */
export const notInteractionOwnerBody = {
  error: NOT_INTERACTION_OWNER,
  code: NOT_INTERACTION_OWNER,
} as const;

/**
 * The userId of the person the conversation's live card is for, or undefined
 * when there is no live card or its person is unknown (single-player history
 * carries no author).
 *
 * The card is the LAST assistant message: a stop marker, a `/clear` boundary or
 * an engine-restart line written after it is a newer assistant message, which
 * is what retires it. Offers-only interactions block nobody.
 */
export function interactionOwner(
  messages: readonly ChatMessage[],
): string | undefined {
  let at = messages.length - 1;
  while (at >= 0 && messages[at]?.role !== "assistant") at--;
  const card = messages[at];
  if (!card || card.stopped) return undefined;
  const interaction = parsePendingInteraction(card.pendingInteraction);
  if (!interaction || hasOnlySuggestionSteps(interaction.steps))
    return undefined;
  // Another member's message can land between a turn's own message and its
  // reply, so the turn id decides; the nearest message only stands in for
  // records written before turn ids existed.
  for (let i = at - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    if (card.turnId === undefined || message.turnId === card.turnId)
      return message.author?.userId;
  }
  return undefined;
}

/**
 * True when `actingUserId` must be refused: there is a live card, its person is
 * known, and it is someone else. No acting identity (desktop, self-host) is
 * never refused.
 */
export function refusesInteractionAnswer(
  messages: readonly ChatMessage[],
  actingUserId: string | undefined,
): boolean {
  if (!actingUserId) return false;
  const owner = interactionOwner(messages);
  return owner !== undefined && owner !== actingUserId;
}
