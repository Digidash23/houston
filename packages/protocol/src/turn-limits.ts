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
  if (
    typeof floor !== "number" ||
    !Number.isInteger(floor) ||
    floor < 1 ||
    floor > MAX_ROUTINE_MIN_INTERVAL_MINUTES
  )
    return undefined;
  return { routineMinIntervalMinutes: floor };
}
