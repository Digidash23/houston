/**
 * The schedule builder's optional floor: a plan's minimum interval between
 * fires (e.g. Free's 15 minutes). The host app binds the plan's own rule as
 * `allows`; the builder never judges a cadence itself, it only asks. So the
 * minutes stepper offers exactly the counts `allows` accepts, presets it
 * refuses are hidden, and Save is blocked for any pick it refuses. Every
 * helper treats an `undefined` floor as "no limit".
 */
import { presetToCron, type ScheduleOptions } from "./schedule-cron-utils.ts";
import {
  type IntervalUnit,
  intervalToCron,
} from "./schedule-interval-utils.ts";
import type { SchedulePreset } from "./types.ts";

export interface ScheduleFloor {
  /** The minimum, in minutes: what the hint under the minutes count names. */
  minutes: number;
  /** Whether a cron fires no more often than the floor allows. */
  allows: (cron: string) => boolean;
}

export interface IntervalCount {
  every: number;
  unit: IntervalUnit;
}

/** A minute step past 59 is no longer a minute cadence (the cron field ends). */
const MAX_MINUTE_COUNT = 59;
const ONE_HOUR: IntervalCount = { every: 1, unit: "hours" };

/** The minute counts the floor allows, ascending; empty when it allows none. */
export function floorMinuteCounts(floor: ScheduleFloor): number[] {
  const counts: number[] = [];
  for (let n = 1; n <= MAX_MINUTE_COUNT; n += 1)
    if (floor.allows(intervalToCron({ every: n, unit: "minutes" }, "00:00")))
      counts.push(n);
  return counts;
}

/** The pick at or above `n` minutes the floor offers: a count, else 1 hour. */
export function snapMinutesUp(n: number, counts: number[]): IntervalCount {
  const every = counts.find((count) => count >= n);
  return every === undefined ? ONE_HOUR : { every, unit: "minutes" };
}

/** The count the minutes stepper starts from: 5, or the first offered at or past it. */
export function defaultMinutesCount(counts: number[] | undefined): number {
  if (!counts) return 5;
  return counts.find((count) => count >= 5) ?? counts[0] ?? 5;
}

/**
 * The count to show after the unit switches, or null to keep it: under a
 * floor, switching to minutes lands on the first offered count at or above
 * the count, or the top one when the count is past them all.
 */
export function countForUnitSwitch(
  every: string,
  unit: IntervalUnit,
  counts: number[] | undefined,
): string | null {
  const n = Number(every);
  const valid = every.trim() !== "" && Number.isInteger(n) && n >= 1;
  if (!counts || unit !== "minutes" || !valid) return null;
  const kept = counts.find((count) => count >= n) ?? counts.at(-1);
  return kept === undefined || kept === n ? null : String(kept);
}

/**
 * Stepper handlers for the minutes count under a floor; undefined without one
 * or on any other unit, where the stepper moves by one as always. `down` is
 * null below the lowest offered count; `up` past the top one moves to 1 hour;
 * `commit` (on blur) snaps a typed count that isn't offered up to the next
 * one that is.
 */
export interface FloorStepper {
  down: (() => void) | null;
  up: () => void;
  commit: () => void;
}

export function floorStepper(
  every: string,
  unit: IntervalUnit,
  counts: number[] | undefined,
  set: (pick: IntervalCount) => void,
): FloorStepper | undefined {
  if (!counts || unit !== "minutes") return undefined;
  const n = Number(every);
  const valid = every.trim() !== "" && Number.isInteger(n) && n >= 1;
  const below = valid ? counts.filter((count) => count < n).at(-1) : undefined;
  return {
    down: below === undefined ? null : () => set({ every: below, unit }),
    up: () => set(snapMinutesUp(valid ? n + 1 : 1, counts)),
    commit: () => {
      if (valid && !counts.includes(n)) set(snapMinutesUp(n, counts));
    },
  };
}

/**
 * Whether the schedule editor's Save is disabled. Under a floor the builder
 * emits "" for a pick it can't save (one the floor refuses, a cleared count);
 * without one, Save behaves as it always has.
 */
export function scheduleSaveBlocked(
  draft: string,
  floor: ScheduleFloor | undefined,
): boolean {
  return floor !== undefined && !draft.trim();
}

/** A preset is offered unless the floor refuses the cron it would write. */
export function presetAllowed(
  preset: SchedulePreset,
  options: ScheduleOptions,
  floor: ScheduleFloor | undefined,
): boolean {
  if (!floor || preset === "custom") return true;
  return floor.allows(presetToCron(preset, options));
}

/**
 * Whether a pick fires no more often than the floor. `pickedCron` is "" for a
 * pick that spells no schedule yet (a cleared count, Weekly with no day),
 * which the builder flags on its own. A minutes count past 59 is no minute
 * cadence, so under a floor it waits for the blur snap to 1 hour.
 */
export function pickAllowed(
  pickedCron: string,
  minutesCount: number | null,
  floor: ScheduleFloor | undefined,
): boolean {
  if (!floor || !pickedCron) return true;
  if (minutesCount !== null && minutesCount > MAX_MINUTE_COUNT) return false;
  return floor.allows(pickedCron);
}
