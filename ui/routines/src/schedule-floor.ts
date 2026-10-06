/**
 * The schedule builder's optional minimum interval (a plan's limit, e.g. Free's
 * 15 minutes): which presets and custom counts fire no more often than the
 * floor. Every helper treats an `undefined` floor as "no limit".
 *
 * Gaps are the REAL smallest gap between two fires, the same reading the
 * server's gate uses: a `*\/N` step restarts at the top of the hour (or day),
 * so "every 25 minutes" fires :00, :25, :50 and then :00 again 10 minutes
 * later. Such a count is refused even though it is above the floor.
 */
import type { IntervalUnit } from "./schedule-interval-utils.ts";
import type { SchedulePreset } from "./types.ts";

const MINUTES_PER_DAY = 1440;

/** Smallest gap of a `*\/every` step over a field of `size` slots (60 min, 24 h). */
function stepGap(every: number, size: number): number {
  if (every >= size) return size;
  const last = Math.floor((size - 1) / every) * every;
  return Math.min(every, size - last);
}

/** Smallest gap, in minutes, between fires of "every `every` `unit`". */
export function intervalGapMinutes(every: number, unit: IntervalUnit): number {
  switch (unit) {
    case "minutes":
      return stepGap(every, 60);
    case "hours":
      return stepGap(every, 24) * 60;
    // A day step restarts each month, so its tightest gap is one day; a
    // month step is never under one day either.
    case "days":
    case "months":
      return MINUTES_PER_DAY;
  }
}

const PRESET_GAP_MINUTES: Record<SchedulePreset, number | null> = {
  every_30min: 30,
  hourly: 60,
  daily: MINUTES_PER_DAY,
  weekly: MINUTES_PER_DAY,
  monthly: MINUTES_PER_DAY,
  // Custom is judged by its count, not as a preset.
  custom: null,
};

export function presetAllowed(
  preset: SchedulePreset,
  floor: number | undefined,
): boolean {
  const gap = PRESET_GAP_MINUTES[preset];
  return floor === undefined || gap === null || gap >= floor;
}

export function countAllowed(
  every: number,
  unit: IntervalUnit,
  floor: number | undefined,
): boolean {
  return floor === undefined || intervalGapMinutes(every, unit) >= floor;
}

/**
 * The nearest allowed count from `from` in `direction` (inclusive of `from`),
 * or null when none exists going down. Going up always ends: a count of a
 * whole field (60 minutes, 24 hours) has the field's full gap.
 */
export function nearestAllowedCount(
  from: number,
  unit: IntervalUnit,
  floor: number | undefined,
  direction: 1 | -1,
): number | null {
  for (let n = Math.max(1, from); n >= 1; n += direction) {
    if (countAllowed(n, unit, floor)) return n;
    if (direction === 1 && n > from + 1440) return null;
  }
  return null;
}

/** The count the minutes stepper starts from: 5, raised to the floor's first allowed count. */
export function defaultMinutesCount(floor: number | undefined): number {
  return nearestAllowedCount(5, "minutes", floor, 1) ?? 5;
}
