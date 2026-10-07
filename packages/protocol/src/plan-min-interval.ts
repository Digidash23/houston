/**
 * The engine's refusal of a routine save that would fire more often than the
 * saver's plan allows: HTTP 400 with this body, on the routine create and
 * update routes, the raw routines-document write and the agent's own save.
 *
 * It lives in the protocol because BOTH ends have to agree on it: the host
 * mints it (`packages/host/src/routes/routine-write-gates.ts`), the client
 * reads it (`@houston/wire-types` re-exports this parser; the SDK classifies
 * the error with it). One shape and one parser, so the two can never drift.
 *
 * Dependency-free and erasable-syntax-only: the app's node test runner loads
 * it through the `@houston/protocol/plan-min-interval` subpath.
 */

/** The machine-readable code beside the refusal's reason. */
export const PLAN_MIN_INTERVAL = "plan_min_interval";

export interface PlanMinIntervalRefusal {
  /** A plain-language reason, written for the agent to relay. */
  error: string;
  code: typeof PLAN_MIN_INTERVAL;
  /** The saver's floor: the fewest minutes allowed between two fires. */
  minIntervalMinutes: number;
}

/** Parse only the exact refusal; any other body is null. */
export function parsePlanMinIntervalRefusal(
  body: unknown,
): PlanMinIntervalRefusal | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  const minutes = value.minIntervalMinutes;
  if (
    value.code !== PLAN_MIN_INTERVAL ||
    typeof value.error !== "string" ||
    typeof minutes !== "number" ||
    !Number.isInteger(minutes) ||
    minutes < 1
  )
    return null;
  return {
    error: value.error,
    code: PLAN_MIN_INTERVAL,
    minIntervalMinutes: minutes,
  };
}
