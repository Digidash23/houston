import type { SlackCompletionFailure } from "@houston/engine-adapter";
import type { SlackCompletion } from "./settings-landing.ts";

/**
 * Why the Slack connection did not happen, from the two places that can refuse
 * it: the callback link itself, mangled so it could never be redeemed, and the
 * gateway refusing the ticket it minted. Both are one vocabulary here — neither
 * source impersonates the other's wire literal.
 *
 *  - `unredeemable` — this link will never connect anything; connect again.
 *  - `taken`        — the Slack account is bound to another Houston account or
 *                     to another of the caller's spaces.
 */
export type SlackCompletionResult = "unredeemable" | "taken";

export function slackCompletionResult(
  landed: SlackCompletion | null,
  refused: SlackCompletionFailure | null,
): SlackCompletionResult | null {
  if (landed?.kind === "invalid" || refused === "invalid")
    return "unredeemable";
  return refused === "already" ? "taken" : null;
}

/**
 * Take the queued completion, each one at most once. The latch holds the last
 * completion actually TAKEN, never the attempt: the Channels body can mount
 * before the landing has queued anything, and a take that found an empty queue
 * must leave the next one free.
 *
 * The desktop app keeps Channels mounted across connects, so a NEW ticket must
 * still pass, while the same ticket delivered twice (the cold-start read and
 * the live listener can both carry the launching link) is dropped: the
 * gateway answers a spent ticket with the same 404 it gives a stranger. A
 * duplicate is cleared too, so a later mount never redeems it either.
 */
export function takeSlackCompletion(
  latch: { current: SlackCompletion | null },
  read: () => SlackCompletion | null,
  clear: () => void,
): SlackCompletion | null {
  const pending = read();
  if (!pending) return null;
  clear();
  if (latch.current && sameCompletion(latch.current, pending)) return null;
  latch.current = pending;
  return pending;
}

function sameCompletion(a: SlackCompletion, b: SlackCompletion): boolean {
  if (a === b) return true;
  return a.kind === "ticket" && b.kind === "ticket" && a.ticket === b.ticket;
}
