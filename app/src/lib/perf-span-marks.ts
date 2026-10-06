import type { FirstResponse, FirstResponseOutcome } from "@houston/sdk";
import type { PerfSpanName } from "./perf-spans.ts";

/**
 * The pure rules behind the perf spans (`perf-spans.ts`): which spans a sent
 * turn's first response yields, and when the opened chat counts as painted.
 */

/** One span a sent turn yields; `ship: false` = PostHog mirror only. */
export interface TurnSpan {
  span: Extract<PerfSpanName, `send_to_${string}`>;
  ms: number;
  ship: boolean;
}

/**
 * The outcomes the gateway's time-to-first-text histogram may hold: a real
 * first text, and a timeout as a censored one (it lands in the last bucket,
 * the ingest clamp). A failure is not a time to first text.
 */
const SHIPPED_TEXT_OUTCOMES: ReadonlySet<FirstResponseOutcome> = new Set([
  "first_text",
  "timeout",
]);

/**
 * A sent turn's spans: `send_to_first_response` for every outcome, and
 * `send_to_first_activity` whenever the turn showed anything, whatever its
 * outcome. A timeout that showed nothing is censored at the deadline, like a
 * text timeout; a turn that ended before showing anything has no activity time.
 */
export function turnSpans(response: FirstResponse): TurnSpan[] {
  const { outcome, sentAt, at, firstActivityAt } = response;
  const spans: TurnSpan[] = [
    {
      span: "send_to_first_response",
      ms: at - sentAt,
      ship: SHIPPED_TEXT_OUTCOMES.has(outcome),
    },
  ];
  const activityAt = firstActivityAt ?? (outcome === "timeout" ? at : null);
  if (activityAt !== null)
    spans.push({
      span: "send_to_first_activity",
      ms: activityAt - sentAt,
      ship: true,
    });
  return spans;
}

/**
 * The conversation whose messages are on screen, or null while none are: the
 * key `card_click_to_chat` completes on. A KEY, not a boolean, so opening a
 * second cached chat (both non-empty) still reads as a new paint.
 */
export function paintedSessionKey(
  sessionKey: string | null,
  feedLength: number,
): string | null {
  return sessionKey !== null && feedLength > 0 ? sessionKey : null;
}
