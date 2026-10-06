import {
  type PlanMinIntervalRefusal,
  parsePlanMinIntervalRefusal,
} from "@houston/wire-types";

/**
 * The plan-floor refusal behind a failed routine create or update (`400
 * plan_min_interval`: the schedule fires more often than the saver's plan
 * allows), or null for every other error. An expected state the person can
 * act on, never a bug. Reads the adapter's parsed `body`, a raw text `body`,
 * or the SDK's own error, whose message is the response text.
 */
export function planMinIntervalRefusal(
  error: unknown,
): PlanMinIntervalRefusal | null {
  if (!(error instanceof Error)) return null;
  const { status, body } = error as { status?: unknown; body?: unknown };
  if (status !== 400) return null;
  if (typeof body === "string") return parseText(body);
  return body === undefined
    ? parseText(error.message)
    : parsePlanMinIntervalRefusal(body);
}

function parseText(text: string): PlanMinIntervalRefusal | null {
  try {
    return parsePlanMinIntervalRefusal(JSON.parse(text));
  } catch {
    return null;
  }
}
