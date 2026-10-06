/**
 * What ScheduleBuilder's picker state means, kept pure so it is tested without
 * mounting: the schedule it would emit, its validity, and the summary line.
 * useScheduleBuilder holds the state and the effects; this file derives.
 */
import {
  interp,
  type ScheduleLabels,
  type ScheduleSummaryLabels,
} from "./labels.ts";
import { presetToCron, type ScheduleOptions } from "./schedule-cron-utils.ts";
import {
  type IntervalUnit,
  intervalCountAllowed,
  intervalCountMax,
  intervalToSchedule,
} from "./schedule-interval-utils.ts";
import { cronSummary, presetSummary } from "./schedule-summary.ts";
import type { SchedulePreset } from "./types";

/** The picker's current choices. */
export interface BuilderPick {
  activePreset: SchedulePreset;
  options: ScheduleOptions;
  /** Held as typed so the field can be cleared; "" is no number. */
  intervalEvery: string;
  intervalUnit: IntervalUnit;
}

export interface BuilderOutput {
  /** The custom count is a whole number from 1 to the unit's maximum. */
  everyValid: boolean;
  /** The custom count is a whole number above the unit's maximum. */
  overMax: boolean;
  /** Weekly needs at least one day. */
  weeklyValid: boolean;
  /** The schedule the picker writes; "" while invalid, so saving is blocked. */
  schedule: string;
}

export function builderOutput(pick: BuilderPick): BuilderOutput {
  const { activePreset, options, intervalEvery, intervalUnit } = pick;
  const every = Number(intervalEvery);
  const typed = intervalEvery.trim() !== "" && Number.isInteger(every);
  const everyValid = typed && intervalCountAllowed(every, intervalUnit);
  const overMax = typed && every > intervalCountMax(intervalUnit);
  const weeklyValid =
    activePreset !== "weekly" || options.daysOfWeek.length > 0;
  let schedule = "";
  if (activePreset === "custom") {
    if (everyValid) {
      schedule = intervalToSchedule(
        { every, unit: intervalUnit, dayOfMonth: options.dayOfMonth },
        options.time,
      );
    }
  } else if (weeklyValid) {
    schedule = presetToCron(activePreset, options);
  }
  return { everyValid, overMax, weeklyValid, schedule };
}

/**
 * The picker writes nothing until the person edits it: an untouched builder
 * leaves a saved schedule exactly as it was (a legacy `*\/16` is not rewritten
 * to `@every 16m` just by opening the editor). A builder seeded with no
 * schedule writes its default pick at once, so a new routine has one to save.
 */
export function builderEmits(touched: boolean, value: string): boolean {
  return touched || value.trim() === "";
}

/** The summary line: the saved schedule while untouched, else the pick. */
export function builderSummary(
  pick: BuilderPick,
  output: BuilderOutput,
  saved: { touched: boolean; value: string },
  labels: Pick<
    ScheduleLabels,
    "enterNumber" | "maxInterval" | "pickDay" | "units"
  > & { summary: ScheduleSummaryLabels },
  locale: string,
): string {
  if (!builderEmits(saved.touched, saved.value)) {
    return cronSummary(saved.value, labels.summary, locale);
  }
  if (pick.activePreset !== "custom") {
    return output.weeklyValid
      ? presetSummary(pick.activePreset, pick.options, labels.summary, locale)
      : labels.pickDay;
  }
  if (output.everyValid) {
    return cronSummary(output.schedule, labels.summary, locale);
  }
  if (output.overMax) {
    return interp(labels.maxInterval, {
      max: new Intl.NumberFormat(locale).format(
        intervalCountMax(pick.intervalUnit),
      ),
      unit: labels.units[pick.intervalUnit],
    });
  }
  return labels.enterNumber;
}
