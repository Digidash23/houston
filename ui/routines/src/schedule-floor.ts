/**
 * The schedule builder's optional floor: a plan's minimum interval between
 * fires (e.g. Free's 15 minutes). The host app binds the plan's own rule as
 * `allows`; the builder never judges a cadence itself, it only asks. So the
 * minutes stepper starts at the lowest count `allows` accepts, presets it
 * refuses are hidden, and Save is blocked for any pick it refuses. Every
 * helper treats an `undefined` floor as "no limit".
 */
import { presetToCron, type ScheduleOptions } from "./schedule-cron-utils.ts";
import {
  type IntervalUnit,
  intervalCountMax,
  intervalToSchedule,
} from "./schedule-interval-utils.ts";
import type { SchedulePreset } from "./types.ts";

export interface ScheduleFloor {
  /** The minimum, in minutes: what the hint under the minutes count names. */
  minutes: number;
  /** Whether a schedule fires no more often than the floor allows. */
  allows: (schedule: string) => boolean;
}

const MAX_MINUTES = intervalCountMax("minutes");

/**
 * The lowest minutes count the floor accepts, or null when it accepts none.
 * Every count above it is offered too: an uneven count saves as a true
 * interval (`@every 16m`) and an even one as the cron that fires exactly as
 * often, so a count's real gap IS the count and only grows with it. The save
 * itself is still judged by `allows` (pickAllowed).
 */
export function floorMinuteMinimum(floor: ScheduleFloor): number | null {
  for (let n = 1; n <= MAX_MINUTES; n += 1)
    if (
      floor.allows(intervalToSchedule({ every: n, unit: "minutes" }, "00:00"))
    )
      return n;
  return null;
}

/** The count the minutes stepper starts from: 5, or the floor's minimum past it. */
export function defaultMinutesCount(
  minimum: number | null | undefined,
): number {
  return minimum == null ? 5 : Math.max(5, minimum);
}

/** A typed count as a whole number of at least 1, else null. */
function typedCount(every: string): number | null {
  const n = Number(every);
  return every.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * The count to show after the unit switches, or null to keep it: under a
 * floor, switching to minutes lifts a count below the minimum onto it.
 */
export function countForUnitSwitch(
  every: string,
  unit: IntervalUnit,
  minimum: number | null | undefined,
): string | null {
  const n = typedCount(every);
  if (minimum == null || unit !== "minutes" || n === null) return null;
  return n < minimum ? String(minimum) : null;
}

/**
 * Stepper handlers for the minutes count under a floor; undefined without one
 * or on any other unit, where the stepper moves by one as always. `down` is
 * null at or below the minimum; `up` from below it lands on it; `commit` (on
 * blur) lifts a typed count below the minimum onto it. Both stop at the unit's
 * maximum. A floor that accepts no minutes count leaves every handler inert:
 * the pick stays refused, so Save stays blocked.
 */
export interface FloorStepper {
  down: (() => void) | null;
  up: () => void;
  commit: () => void;
}

export function floorStepper(
  every: string,
  unit: IntervalUnit,
  minimum: number | null | undefined,
  set: (every: number) => void,
): FloorStepper | undefined {
  if (minimum === undefined || unit !== "minutes") return undefined;
  if (minimum === null) return { down: null, up: () => {}, commit: () => {} };
  const n = typedCount(every);
  const lower = n === null ? null : Math.min(MAX_MINUTES, n - 1);
  return {
    down: lower === null || lower < minimum ? null : () => set(lower),
    up: () => set(Math.min(MAX_MINUTES, Math.max(minimum, (n ?? 0) + 1))),
    commit: () => {
      if (n !== null && n < minimum) set(minimum);
    },
  };
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
 * Whether a pick fires no more often than the floor. `picked` is "" for a pick
 * that spells no schedule yet (a cleared count, Weekly with no day), which the
 * builder flags on its own.
 */
export function pickAllowed(
  picked: string,
  floor: ScheduleFloor | undefined,
): boolean {
  return !floor || !picked || floor.allows(picked);
}
