/**
 * The schedule builder's optional minimum interval (a plan's limit, e.g. Free's
 * 15 minutes). Every helper treats an `undefined` floor as "no limit".
 *
 * Under a floor the minutes count only offers counts that divide the hour
 * evenly and reach the floor (15: 15, 20, 30). An uneven step restarts at the
 * top of the hour and fires sooner than it says ("every 25 minutes" fires :50
 * then :00), which the server's gate refuses. Past the top count the next
 * choice is 1 hour. Hours, days and months are never limited.
 */
import type { IntervalUnit } from "./schedule-interval-utils.ts";
import type { SchedulePreset } from "./types.ts";

const EVEN_MINUTE_COUNTS = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30];
const ONE_HOUR: IntervalCount = { every: 1, unit: "hours" };

export interface IntervalCount {
  every: number;
  unit: IntervalUnit;
}

/** The minute counts a floor allows, ascending. Empty when the floor is above 30. */
export function floorMinuteCounts(floor: number): number[] {
  return EVEN_MINUTE_COUNTS.filter((n) => n >= floor);
}

export function minuteCountAllowed(n: number, floor: number | undefined) {
  return floor === undefined || floorMinuteCounts(floor).includes(n);
}

/** The allowed pick at or above `n` minutes: an offered count, else 1 hour. */
export function snapMinutesUp(n: number, floor: number): IntervalCount {
  const every = floorMinuteCounts(floor).find((count) => count >= n);
  return every === undefined ? ONE_HOUR : { every, unit: "minutes" };
}

/** The stepper's next pick from `n` minutes; going up past the top count is 1 hour. */
export function stepMinutes(
  n: number,
  floor: number,
  direction: 1 | -1,
): IntervalCount | null {
  const counts = floorMinuteCounts(floor);
  if (direction === 1) return snapMinutesUp(n + 1, floor);
  const every = counts.filter((count) => count < n).pop();
  return every === undefined ? null : { every, unit: "minutes" };
}

/** The count the minutes stepper starts from: 5, or the floor's first count. */
export function defaultMinutesCount(floor: number | undefined): number {
  if (floor === undefined) return 5;
  return floorMinuteCounts(floor).find((count) => count >= 5) ?? 5;
}

/**
 * The count to show after the unit switches, or null to keep it: under a
 * floor, switching to minutes lands on an offered count (2 hours → 15
 * minutes, 40 days → 30 minutes).
 */
export function countForUnitSwitch(
  every: string,
  unit: IntervalUnit,
  floor: number | undefined,
): string | null {
  const n = Number(every);
  const valid = every.trim() !== "" && Number.isInteger(n) && n >= 1;
  if (floor === undefined || unit !== "minutes" || !valid) return null;
  const counts = floorMinuteCounts(floor);
  const kept = counts.find((count) => count >= n) ?? counts.at(-1);
  return kept === undefined || kept === n ? null : String(kept);
}

/**
 * Stepper handlers for the minutes count under a floor; undefined without one
 * or on any other unit, where the stepper moves by one as always. `down`/`up`
 * are null where there is nowhere to go; `commit` (on blur) snaps a typed
 * count that isn't offered up to the nearest one that is.
 */
export interface FloorStepper {
  down: (() => void) | null;
  up: (() => void) | null;
  commit: () => void;
}

export function floorStepper(
  every: string,
  unit: IntervalUnit,
  floor: number | undefined,
  set: (pick: IntervalCount) => void,
): FloorStepper | undefined {
  if (floor === undefined || unit !== "minutes") return undefined;
  const n = Number(every);
  const valid = every.trim() !== "" && Number.isInteger(n) && n >= 1;
  const go = (to: IntervalCount | null) => (to ? () => set(to) : null);
  return {
    down: valid ? go(stepMinutes(n, floor, -1)) : null,
    up: go(stepMinutes(valid ? n : 0, floor, 1)),
    commit: () => {
      if (valid && !minuteCountAllowed(n, floor)) set(snapMinutesUp(n, floor));
    },
  };
}

const PRESET_GAP_MINUTES: Record<SchedulePreset, number | null> = {
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
  const gap = PRESET_GAP_MINUTES[preset];
  return floor === undefined || gap === null || gap >= floor;
}
