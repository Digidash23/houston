/**
 * True-interval schedules: `@every <N>m` / `@every <N>h`, the second form a
 * routine's `schedule` string can take beside cron. Cron's `*\/16` restarts at
 * :00 every hour (…:32, :48, :00); an interval keeps the cadence (:48 -> :04).
 *
 * Fires sit on a grid counted from the Unix epoch, so every replica, device and
 * restart computes the same instants with no stored anchor. The grid is UTC: the
 * account timezone does not move it.
 *
 * `ui/routines/src/schedule-interval-form.ts` duplicates the parser and the
 * canonicalizer (ui/ cannot import domain); `schedule-interval.fixtures.json`
 * pins both copies to one table.
 */

export type IntervalScheduleUnit = "minutes" | "hours";

export interface IntervalSchedule {
  every: number;
  unit: IntervalScheduleUnit;
  /** The cadence in minutes (`every`, or `every * 60` for hours). */
  stepMinutes: number;
}

/** Seven days: an interval longer than a week is not offered or accepted. */
export const MAX_INTERVAL_MINUTES = 10_080;

const INTERVAL_FORM = /^@every ([1-9]\d{0,4})(m|h)$/;
const MINUTE_MS = 60_000;

/** True when the string is written in the interval form, valid or not. */
export function isIntervalForm(schedule: string): boolean {
  return schedule.trim().startsWith("@every");
}

/** The interval a schedule names, or null (not an interval, or invalid). */
export function parseIntervalSchedule(
  schedule: string,
): IntervalSchedule | null {
  const match = schedule.trim().match(INTERVAL_FORM);
  if (!match) return null;
  const every = Number(match[1]);
  const unit: IntervalScheduleUnit = match[2] === "h" ? "hours" : "minutes";
  const stepMinutes = unit === "hours" ? every * 60 : every;
  if (stepMinutes > MAX_INTERVAL_MINUTES) return null;
  return { every, unit, stepMinutes };
}

/** Why an interval-form schedule is invalid, or null when it is valid. */
export function intervalScheduleError(schedule: string): string | null {
  if (parseIntervalSchedule(schedule)) return null;
  if (!INTERVAL_FORM.test(schedule.trim())) {
    return "an interval is written '@every <N>m' or '@every <N>h' with one whole number and one unit (90m, not 1h30m)";
  }
  return "an interval can be at most 7 days (10080m or 168h)";
}

/** The first grid instant strictly after `after`. */
export function nextIntervalRun(interval: IntervalSchedule, after: Date): Date {
  const step = interval.stepMinutes * MINUTE_MS;
  return new Date((Math.floor(after.getTime() / step) + 1) * step);
}

/**
 * The schedule string for "every N minutes/hours". Cron when N divides its
 * parent unit (the cron then fires on the same even cadence and every older
 * reader understands it), the interval form otherwise. A minutes count that is
 * whole hours dividing 24 becomes the hours cron.
 */
export function intervalSchedule(
  every: number,
  unit: IntervalScheduleUnit,
): string {
  if (unit === "minutes" && every < 60 && 60 % every === 0) {
    return every === 1 ? "* * * * *" : `*/${every} * * * *`;
  }
  const hours = unit === "hours" ? every : every / 60;
  if (Number.isInteger(hours) && 24 % hours === 0) {
    return hours === 1 ? "0 * * * *" : `0 */${hours} * * *`;
  }
  return `@every ${every}${unit === "hours" ? "h" : "m"}`;
}

/** A valid interval rewritten to its canonical form; anything else unchanged. */
export function canonicalSchedule(schedule: string): string {
  const interval = parseIntervalSchedule(schedule);
  return interval ? intervalSchedule(interval.every, interval.unit) : schedule;
}
