import {
  everyStepMinutes,
  parseEverySchedule,
} from "./schedule-interval-form.ts";

/**
 * The next fire of an `@every` interval strictly after `from`: the next instant
 * on its UTC grid counted from the Unix epoch, so the routine's timezone never
 * moves it. Null when the interval is invalid.
 */
export function nextEveryFire(schedule: string, from: Date): Date | null {
  const interval = parseEverySchedule(schedule);
  if (!interval) return null;
  const step = everyStepMinutes(interval) * 60_000;
  return new Date((Math.floor(from.getTime() / step) + 1) * step);
}
