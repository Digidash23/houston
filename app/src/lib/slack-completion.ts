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
 * Take the queued completion and clear it in the same pass. `read` must answer
 * the queue as it is NOW, not a render's snapshot of it: an effect that runs
 * twice over one render (StrictMode, a dependency change) then finds the queue
 * already empty, so a ticket is never redeemed twice from one hand-over. A
 * replayed deep link never reaches the queue at all (`settings-link-gate.ts`).
 */
export function takeSlackCompletion(
  read: () => SlackCompletion | null,
  clear: () => void,
): SlackCompletion | null {
  const pending = read();
  if (pending) clear();
  return pending;
}
