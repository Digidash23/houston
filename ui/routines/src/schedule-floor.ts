/**
 * The schedule builder's optional minimum interval (a plan's limit, e.g. Free's
 * 15 minutes). It is a plain minimum on the custom minutes count, plus hiding
 * any preset whose nominal interval is shorter (none at 15). Hours, days and
 * months are never limited. Every helper treats an `undefined` floor as "no
 * limit".
 */
import type { IntervalUnit } from "./schedule-interval-utils.ts";
import type { SchedulePreset } from "./types.ts";

export function minuteCountAllowed(n: number, floor: number | undefined) {
  return floor === undefined || n >= floor;
}

/** The count the minutes stepper starts from: 5, raised to the floor. */
export function defaultMinutesCount(floor: number | undefined): number {
  return floor === undefined ? 5 : Math.max(5, floor);
}

/**
 * The count to show after the unit switches, or null to keep it: under a
 * floor, switching to minutes raises a count below it to the floor (2 hours
 * → 15 minutes); a count already at or above it stays.
 */
export function countForUnitSwitch(
  every: string,
  unit: IntervalUnit,
  floor: number | undefined,
): string | null {
  const n = Number(every);
  const valid = every.trim() !== "" && Number.isInteger(n) && n >= 1;
  if (floor === undefined || unit !== "minutes" || !valid || n >= floor)
    return null;
  return String(floor);
}

const PRESET_INTERVAL_MINUTES: Record<SchedulePreset, number | null> = {
  every_30min: 30,
  hourly: 60,
  daily: 1440,
  weekly: 1440,
  monthly: 1440,
  // Custom is judged by its count, not as a preset.
  custom: null,
};

export function presetAllowed(
  preset: SchedulePreset,
  floor: number | undefined,
): boolean {
  const interval = PRESET_INTERVAL_MINUTES[preset];
  return floor === undefined || interval === null || interval >= floor;
}
