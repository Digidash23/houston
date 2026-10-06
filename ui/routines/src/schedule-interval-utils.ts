/**
 * Friendly "Repeat every N …" interval helpers for the custom branch of
 * ScheduleBuilder. Keeps the non-technical interval model and its mapping to and
 * from schedule strings (cron, or the `@every` interval form) in one place,
 * separate from the preset cron logic.
 *
 * Units: minutes / hours / days (run on an interval) and months (a day-of-month,
 * every N months). Weekly-on-chosen-days lives in the Weekly preset, not here.
 */
import { parseTime } from "./schedule-format.ts";
import {
  everySchedule,
  everyStepMinutes,
  MAX_INTERVAL_MINUTES,
  parseEverySchedule,
} from "./schedule-interval-form.ts";

/** Unit for the friendly "Repeat every N …" custom-interval picker. */
export type IntervalUnit = "minutes" | "hours" | "days" | "months";

export interface ScheduleInterval {
  every: number; // 1, 2, 3, …
  unit: IntervalUnit;
  /** Day-of-month (1–31) for the "months" unit. */
  dayOfMonth?: number;
}

/**
 * A positive whole count, and for minutes/hours no longer than the 7-day
 * interval cap. Days and months have no cap.
 */
export function intervalCountAllowed(every: number, unit: IntervalUnit) {
  if (!Number.isInteger(every) || every < 1) return false;
  if (unit !== "minutes" && unit !== "hours") return true;
  return everyStepMinutes({ every, unit }) <= MAX_INTERVAL_MINUTES;
}

/**
 * Build a schedule string from a friendly interval.
 * - minutes/hours: a true interval around the clock; cron `*​/N` when N divides
 *   the hour (or day), else `@every Nm` / `@every Nh`.
 * - days: `*​/N` in the day-of-month field, at a fixed time.
 * - months: a fixed day-of-month, every N months (`*​/N` in the month field).
 */
export function intervalToSchedule(
  interval: ScheduleInterval,
  time: string,
): string {
  const every = Math.max(1, Math.floor(interval.every));
  const { hour, minute } = parseTime(time);
  switch (interval.unit) {
    case "minutes":
    case "hours":
      return everySchedule(every, interval.unit);
    case "days":
      return every === 1
        ? `${minute} ${hour} * * *`
        : `${minute} ${hour} */${every} * *`;
    case "months": {
      const dom =
        interval.dayOfMonth && interval.dayOfMonth >= 1
          ? interval.dayOfMonth
          : 1;
      return every === 1
        ? `${minute} ${hour} ${dom} * *`
        : `${minute} ${hour} ${dom} */${every} *`;
    }
  }
}

/**
 * Parse a schedule (cron or `@every`) back into a friendly interval, when it
 * maps cleanly onto one. Returns `null` for anything the picker can't
 * represent, so the caller can keep the raw schedule untouched instead of
 * misrepresenting it. A legacy `*​/16` still reads back as 16 minutes.
 */
export function scheduleToInterval(schedule: string): ScheduleInterval | null {
  const every = parseEverySchedule(schedule);
  if (every) return every;
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts;
  const numericTime = /^\d+$/.test(min) && /^\d+$/.test(hour);

  // Monthly on a day-of-month: "M H <dom> <*|*/N> *".
  if (numericTime && dow === "*" && /^\d+$/.test(dom)) {
    if (month === "*")
      return { every: 1, unit: "months", dayOfMonth: Number(dom) };
    const monthStep = month.match(/^\*\/(\d+)$/);
    if (monthStep)
      return {
        every: Number(monthStep[1]),
        unit: "months",
        dayOfMonth: Number(dom),
      };
  }

  // Remaining (minute/hour/day) cases need an unrestricted month + day-of-week.
  if (month !== "*" || dow !== "*") return null;

  if (dom === "*") {
    // Every N minutes: "*/N * * * *" (and "* * * * *" = every minute).
    const minStep = min.match(/^\*\/(\d+)$/);
    if (hour === "*" && (min === "*" || minStep)) {
      return { every: minStep ? Number(minStep[1]) : 1, unit: "minutes" };
    }
    // Every N hours on the hour: "0 */N * * *" (and "0 * * * *" = hourly).
    const hourStep = hour.match(/^\*\/(\d+)$/);
    if (min === "0" && (hour === "*" || hourStep)) {
      return { every: hourStep ? Number(hourStep[1]) : 1, unit: "hours" };
    }
    // Daily at a fixed time: "M H * * *".
    if (numericTime) return { every: 1, unit: "days" };
    return null;
  }

  // Every N days at a fixed time: "M H */N * *".
  const domStep = dom.match(/^\*\/(\d+)$/);
  if (numericTime && domStep)
    return { every: Number(domStep[1]), unit: "days" };
  return null;
}
