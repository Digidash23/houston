/**
 * C19: the trigger events a Free plan refused for one routine, carried on its
 * trigger-status item (`GET /v1/agents/:slug/trigger-status`). A refused
 * webhook or app event is dropped before it becomes a run, so this count is
 * the only trace the person can see of it.
 */

/** Why the plan refused an event. A CLOSED set: anything else is dropped. */
export const TRIGGER_PLAN_SKIP_CODES = [
  /** The routine fired sooner than the Free minimum interval allows. */
  "plan_min_interval",
  /** Free keeps one routine running and this is not the kept one. */
  "plan_routine_limit",
  /** Routines paused after days without the app being opened. */
  "plan_inactive",
] as const;

export type TriggerPlanSkipCode = (typeof TRIGGER_PLAN_SKIP_CODES)[number];

/**
 * The routine's refused events over the last 24 hours. `code` and `last_at`
 * describe the most recent refusal; the gateway omits the field when there
 * were none.
 */
export interface TriggerPlanSkipped {
  code: TriggerPlanSkipCode;
  count: number;
  last_at: string;
}

function isSkipCode(value: unknown): value is TriggerPlanSkipCode {
  return (
    typeof value === "string" &&
    (TRIGGER_PLAN_SKIP_CODES as readonly string[]).includes(value)
  );
}

/**
 * The exact C19 shape, or null. A newer gateway may add a code this client
 * cannot explain, and a notice that guesses would tell the person the wrong
 * reason, so an unknown code, a non-positive count or an unreadable time
 * drops the whole field instead of failing the status read.
 */
export function parseTriggerPlanSkipped(
  value: unknown,
): TriggerPlanSkipped | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    !isSkipCode(raw.code) ||
    typeof raw.count !== "number" ||
    !Number.isInteger(raw.count) ||
    raw.count < 1 ||
    typeof raw.last_at !== "string" ||
    !Number.isFinite(Date.parse(raw.last_at))
  )
    return null;
  return { code: raw.code, count: raw.count, last_at: raw.last_at };
}
