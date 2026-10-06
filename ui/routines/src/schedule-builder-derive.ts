/**
 * The pure half of useScheduleBuilder: from the picker's state, which cron the
 * builder emits and whether the choice is valid. Kept out of the hook so the
 * rules (including the optional minimum interval) are testable without React.
 */
import { presetToCron, type ScheduleOptions } from "./schedule-cron-utils.ts";
import { countAllowed, presetAllowed } from "./schedule-floor.ts";
import {
  type IntervalUnit,
  intervalToCron,
} from "./schedule-interval-utils.ts";
import type { SchedulePreset } from "./types.ts";

export interface BuilderPick {
  activePreset: SchedulePreset;
  options: ScheduleOptions;
  /** The custom count as typed; "" while the field is cleared. */
  intervalEvery: string;
  intervalUnit: IntervalUnit;
  /** Smallest allowed gap between fires, in minutes. Undefined = no floor. */
  minIntervalMinutes?: number;
}

export interface DerivedSchedule {
  /** The custom count is a positive whole number. */
  everyValid: boolean;
  /** The Weekly preset has at least one day. */
  weeklyValid: boolean;
  /** The pick fires no more often than the floor (always true without one). */
  floorOk: boolean;
  /** The cron the pick spells, valid or not; "" when it spells none. */
  pickedCron: string;
  /** What the builder emits: `pickedCron` when the pick is valid, else "" so
   *  the parent's save validation blocks saving. */
  cron: string;
}

export function deriveSchedule(pick: BuilderPick): DerivedSchedule {
  const { activePreset, options, intervalEvery, intervalUnit } = pick;
  const floor = pick.minIntervalMinutes;
  const everyNumber = Number(intervalEvery);
  const everyValid =
    intervalEvery.trim() !== "" &&
    Number.isInteger(everyNumber) &&
    everyNumber >= 1;
  const weeklyValid =
    activePreset !== "weekly" || options.daysOfWeek.length > 0;

  if (activePreset === "custom") {
    const pickedCron = everyValid
      ? intervalToCron(
          {
            every: everyNumber,
            unit: intervalUnit,
            dayOfMonth: options.dayOfMonth,
          },
          options.time,
        )
      : "";
    const floorOk =
      !everyValid || countAllowed(everyNumber, intervalUnit, floor);
    const cron = everyValid && floorOk ? pickedCron : "";
    return { everyValid, weeklyValid, floorOk, pickedCron, cron };
  }
  const pickedCron = weeklyValid ? presetToCron(activePreset, options) : "";
  const floorOk = presetAllowed(activePreset, floor);
  const cron = floorOk ? pickedCron : "";
  return { everyValid, weeklyValid, floorOk, pickedCron, cron };
}
