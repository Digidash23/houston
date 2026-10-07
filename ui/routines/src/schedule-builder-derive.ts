/**
 * The pure half of useScheduleBuilder: from the picker's state, which cron the
 * builder emits and whether the choice is valid. Kept out of the hook so the
 * rules (including the optional minimum interval) are testable without React.
 */
import type { ScheduleLabels } from "./labels.ts";
import { presetToCron, type ScheduleOptions } from "./schedule-cron-utils.ts";
import { pickAllowed, type ScheduleFloor } from "./schedule-floor.ts";
import {
  type IntervalUnit,
  intervalToCron,
} from "./schedule-interval-utils.ts";
import { cronSummary, presetSummary } from "./schedule-summary.ts";
import type { SchedulePreset } from "./types.ts";

export interface BuilderPick {
  activePreset: SchedulePreset;
  options: ScheduleOptions;
  /** The custom count as typed; "" while the field is cleared. */
  intervalEvery: string;
  intervalUnit: IntervalUnit;
  /** A plan's minimum interval and the rule that judges it. Undefined = none. */
  floor?: ScheduleFloor;
}

export interface DerivedSchedule {
  /** The custom count is a positive whole number. */
  everyValid: boolean;
  /** The Weekly preset has at least one day. */
  weeklyValid: boolean;
  /** The floor's rule accepts the pick (always true without one). */
  floorOk: boolean;
  /** The cron the pick spells, valid or not; "" when it spells none. */
  pickedCron: string;
  /** What the builder emits: `pickedCron` when the pick is valid, else "" so
   *  the parent's save validation blocks saving. */
  cron: string;
}

export function deriveSchedule(pick: BuilderPick): DerivedSchedule {
  const { activePreset, options, intervalEvery, intervalUnit, floor } = pick;
  const everyNumber = Number(intervalEvery);
  const everyValid =
    intervalEvery.trim() !== "" &&
    Number.isInteger(everyNumber) &&
    everyNumber >= 1;
  const weeklyValid =
    activePreset !== "weekly" || options.daysOfWeek.length > 0;

  const custom = activePreset === "custom";
  let pickedCron = "";
  if (custom && everyValid)
    pickedCron = intervalToCron(
      {
        every: everyNumber,
        unit: intervalUnit,
        dayOfMonth: options.dayOfMonth,
      },
      options.time,
    );
  else if (!custom && weeklyValid)
    pickedCron = presetToCron(activePreset, options);
  // Every pick, preset or custom count, is judged by the floor's own rule.
  const minutesCount =
    custom && intervalUnit === "minutes" ? everyNumber : null;
  const floorOk = pickAllowed(pickedCron, minutesCount, floor);
  const cron = floorOk ? pickedCron : "";
  return { everyValid, weeklyValid, floorOk, pickedCron, cron };
}

/**
 * The builder's live read-back. `untouchedLegacy` is a saved cron the picker
 * can't represent, described as it is until the user edits. A pick under the
 * floor is still described as picked, so the read-back never lies.
 */
export function builderSummary(
  untouchedLegacy: string | null,
  pick: Pick<BuilderPick, "activePreset" | "options"> &
    Pick<DerivedSchedule, "everyValid" | "weeklyValid" | "pickedCron">,
  labels: ScheduleLabels,
  locale: string,
): string {
  if (untouchedLegacy !== null)
    return cronSummary(untouchedLegacy, labels.summary, locale);
  if (pick.activePreset !== "custom")
    return pick.weeklyValid
      ? presetSummary(pick.activePreset, pick.options, labels.summary, locale)
      : labels.pickDay;
  return pick.everyValid
    ? cronSummary(pick.pickedCron, labels.summary, locale)
    : labels.enterNumber;
}
