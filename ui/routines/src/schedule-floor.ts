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

/**
 * The count stepper's rules, `min` being the floor on the minutes count (the
 * caller passes it only for that unit) and 1 without one. `n` is the shown
 * count, read as 1 while the field is empty.
 */
export function stepperCanDecrease(n: number, min: number | undefined) {
  return n > (min ?? 1);
}

export function stepperDecrease(n: number, min: number | undefined): number {
  return Math.max(min ?? 1, n - 1);
}

/** Plus from a count under the floor lands ON the floor, not one past it. */
export function stepperIncrease(n: number, min: number | undefined): number {
  return Math.max(min ?? 1, n + 1);
}

/** The count a typed value snaps to on blur, or null to leave it. */
export function stepperBlurSnap(
  value: string,
  min: number | undefined,
): string | null {
  if (min === undefined || value.trim() === "") return null;
  return Number(value) < min ? String(min) : null;
}

/**
 * Whether the schedule editor's Save is disabled. Under a floor the builder
 * emits "" for a pick it can't save (a count under the floor, a cleared
 * count); without one, Save behaves as it always has.
 */
export function scheduleSaveBlocked(
  draft: string,
  floor: number | undefined,
): boolean {
  return floor !== undefined && !draft.trim();
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
