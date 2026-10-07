/**
 * The plan limits a turn runs under, as the cloud gateway stamps them on the
 * turn body it forwards (top-level `limits`). Only the gateway sends them, and
 * only for a person whose plan has a limit; clients never do. Absent = no
 * limit: Plus, the plan system off, the desktop, self-host.
 */
export interface TurnLimits {
  /**
   * The fewest minutes a routine this turn saves may leave between two fires.
   * The engine refuses a schedule that runs more often (routine-write.ts).
   */
  routineMinIntervalMinutes?: number;
}

/** A day: a floor above it would refuse every schedule, so it is not a floor. */
const MAX_ROUTINE_MIN_INTERVAL_MINUTES = 1440;

/** A floor the engine honors: a whole number of minutes, 1 to a day. */
function validFloor(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_ROUTINE_MIN_INTERVAL_MINUTES
  );
}

/**
 * Normalize an untrusted wire value into {@link TurnLimits}. Sibling of
 * `parseMentions`: anything but a plain object is no limits, and a field
 * survives only as an integer in its range, so a garbled stamp can never make
 * a turn stricter than a real plan or fail the send. An empty result is
 * `undefined`, never `{}`.
 */
export function parseTurnLimits(value: unknown): TurnLimits | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const floor = (value as { routineMinIntervalMinutes?: unknown })
    .routineMinIntervalMinutes;
  return validFloor(floor) ? { routineMinIntervalMinutes: floor } : undefined;
}

/**
 * The plan floor the gateway stamps on a routine write it proxies for a person
 * on a plan with one (`POST /agents/:id/routines`, `PATCH
 * /agents/:id/routines/:rid`): the fewest minutes between fires that person's
 * save may set. The gateway strips any client-sent copy, and the host trusts
 * it only where a gateway fronts every request. The request-scoped twin of
 * {@link TurnLimits.routineMinIntervalMinutes}.
 */
export const ROUTINE_FLOOR_HEADER = "x-houston-routine-floor";

/**
 * The floor a {@link ROUTINE_FLOOR_HEADER} value names, or undefined for an
 * absent or garbled one (no floor, never a failed write). Node joins a
 * repeated custom header into one string ("1, 15"), which fails the digits
 * check and so reads as no floor; the gateway Sets the header, so it never
 * sends two. The array arm only covers the `IncomingHttpHeaders` type.
 */
export function parseRoutineFloorHeader(
  value: string | string[] | undefined,
): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) return undefined;
  const floor = Number(raw.trim());
  return validFloor(floor) ? floor : undefined;
}
