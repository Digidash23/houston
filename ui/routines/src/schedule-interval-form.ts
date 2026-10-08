/**
 * The `@every <N>m` / `@every <N>h` schedule form: "every N minutes/hours" on a
 * true interval, so every 16 minutes after a :48 fire goes to :04 (cron's
 * `*\/16` restarts at :00). Fires sit on a UTC grid counted from the Unix epoch.
 *
 * A copy of `packages/domain/src/schedule-interval.ts` (ui/ cannot import
 * domain). `tests/schedule-interval.fixtures.json` pins both copies to one table.
 */

export type EveryUnit = "minutes" | "hours";

export interface EverySchedule {
  every: number;
  unit: EveryUnit;
}

/** Seven days: an interval longer than a week is not offered or accepted. */
export const MAX_INTERVAL_MINUTES = 10_080;

const INTERVAL_FORM = /^@every ([1-9]\d{0,4})(m|h)$/;

/** The interval's cadence in minutes. */
export function everyStepMinutes({ every, unit }: EverySchedule): number {
  return unit === "hours" ? every * 60 : every;
}

/** True when the string is written in the interval form, valid or not. */
export function isEveryForm(schedule: string): boolean {
  return schedule.trim().startsWith("@every");
}

/** The interval a schedule names, or null (not an interval, or invalid). */
export function parseEverySchedule(schedule: string): EverySchedule | null {
  const match = schedule.trim().match(INTERVAL_FORM);
  if (!match) return null;
  const interval: EverySchedule = {
    every: Number(match[1]),
    unit: match[2] === "h" ? "hours" : "minutes",
  };
  return everyStepMinutes(interval) > MAX_INTERVAL_MINUTES ? null : interval;
}

/**
 * The schedule string for "every N minutes/hours". Cron when N divides its
 * parent unit (same even cadence, and every older reader understands it), the
 * interval form otherwise. A minutes count that is whole hours dividing 24
 * becomes the hours cron.
 */
export function everySchedule(every: number, unit: EveryUnit): string {
  if (unit === "minutes" && every < 60 && 60 % every === 0) {
    return every === 1 ? "* * * * *" : `*/${every} * * * *`;
  }
  const hours = unit === "hours" ? every : every / 60;
  if (Number.isInteger(hours) && 24 % hours === 0) {
    return hours === 1 ? "0 * * * *" : `0 */${hours} * * *`;
  }
  return `@every ${every}${unit === "hours" ? "h" : "m"}`;
}
