/**
 * State and cron-derivation logic for ScheduleBuilder, kept separate from the
 * JSX so each file stays small and the behaviour is easy to reason about.
 */
import { useEffect, useRef, useState } from "react";
import { DEFAULT_SCHEDULE_LABELS, type ScheduleLabels } from "./labels";
import { builderSummary, deriveSchedule } from "./schedule-builder-derive";
import {
  cronToOptions,
  cronToPreset,
  type ScheduleOptions,
} from "./schedule-cron-utils";
import {
  countForUnitSwitch,
  defaultMinutesCount,
  type FloorStepper,
  floorStepper,
  type ScheduleFloor,
} from "./schedule-floor";
import { cronToInterval, type IntervalUnit } from "./schedule-interval-utils";
import type { SchedulePreset } from "./types";
import {
  useFloorMinuteCounts,
  useLateFloorDefault,
  useOutsideCronSync,
} from "./use-schedule-builder-sync";

const DEFAULT_OPTIONS: ScheduleOptions = {
  time: "09:00",
  daysOfWeek: [1],
  dayOfMonth: 1,
};

const NEEDS_TIME: SchedulePreset[] = ["daily", "weekly", "monthly"];

export interface ScheduleBuilderState {
  activePreset: SchedulePreset;
  selectPreset: (preset: SchedulePreset) => void;
  options: ScheduleOptions;
  updateOption: (patch: Partial<ScheduleOptions>) => void;
  intervalEvery: string;
  setIntervalEvery: (every: string) => void;
  intervalUnit: IntervalUnit;
  setIntervalUnit: (unit: IntervalUnit) => void;
  everyValid: boolean;
  /** The floor's rule accepts the pick (true without one). */
  floorOk: boolean;
  /** Minutes-count stepping under the floor; undefined = step by one. */
  stepper: FloorStepper | undefined;
  isCustom: boolean;
  showTime: boolean;
  summary: string;
}

export function useScheduleBuilder(
  value: string,
  onChange: (cronExpression: string) => void,
  labels: ScheduleLabels = DEFAULT_SCHEDULE_LABELS,
  locale = "en-US",
  floor?: ScheduleFloor,
): ScheduleBuilderState {
  const minuteCounts = useFloorMinuteCounts(floor);
  // Detect initial preset/interval from the incoming cron.
  const detectedPreset = cronToPreset(value);
  const detectedOptions = cronToOptions(value);
  const detectedInterval =
    detectedPreset === "custom" ? cronToInterval(value) : null;

  // A pre-existing custom cron the picker can't represent (e.g. a weekday range
  // from a legacy routine). We keep it untouched until the user actively edits,
  // so opening the editor never silently rewrites their schedule.
  const [unrepresentable] = useState(
    () => detectedPreset === "custom" && !cronToInterval(value),
  );
  const [touched, setTouched] = useState(false);

  const [activePreset, setActivePreset] = useState<SchedulePreset>(
    detectedPreset ?? "daily",
  );
  const [options, setOptions] = useState<ScheduleOptions>({
    ...DEFAULT_OPTIONS,
    ...detectedOptions,
  });
  // The interval count is held as a string so the field can be cleared fully
  // while typing (e.g. to replace "1" with "984"); "" means no valid number.
  const [intervalEvery, setEvery] = useState(
    detectedInterval
      ? String(detectedInterval.every)
      : String(defaultMinutesCount(minuteCounts)),
  );
  const [intervalUnit, setUnit] = useState<IntervalUnit>(
    detectedInterval ? detectedInterval.unit : "minutes",
  );

  // Still the builder's own default count until `value`, an edit or a unit
  // switch sets it: only then does a late floor move it.
  const countIsDefault = useRef(!detectedInterval);
  useLateFloorDefault(minuteCounts, countIsDefault, setEvery);

  // A count must be a positive whole number, Weekly needs a day, and a pick
  // under the floor emits "" so the parent blocks saving it.
  const { everyValid, weeklyValid, floorOk, pickedCron, cron } = deriveSchedule(
    { activePreset, options, intervalEvery, intervalUnit, floor },
  );

  // Stable ref for onChange to avoid infinite effect loops.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Emit cron when preset, options or interval change. An invalid (empty)
  // interval count emits "" so the parent's save validation can block saving.
  // biome-ignore lint/correctness/useExhaustiveDependencies: every picker edit must re-emit even when the cron string is unchanged, so an edit always replaces an outside value the picker could not represent
  useEffect(() => {
    if (unrepresentable && !touched) return;
    onChangeRef.current(cron);
  }, [
    activePreset,
    options,
    intervalEvery,
    intervalUnit,
    touched,
    unrepresentable,
    everyValid,
    weeklyValid,
    cron,
  ]);

  const selectPreset = (preset: SchedulePreset) => {
    setActivePreset(preset);
    setTouched(true);
  };
  const updateOption = (patch: Partial<ScheduleOptions>) => {
    setOptions((prev) => ({ ...prev, ...patch }));
    setTouched(true);
  };
  const setIntervalEvery = (every: string) => {
    countIsDefault.current = false;
    setEvery(every);
    setTouched(true);
  };
  const setIntervalUnit = (unit: IntervalUnit) => {
    countIsDefault.current = false;
    setUnit(unit);
    setTouched(true);
    const kept = countForUnitSwitch(intervalEvery, unit, minuteCounts);
    if (kept !== null) setEvery(kept);
  };
  const stepper = floorStepper(
    intervalEvery,
    intervalUnit,
    minuteCounts,
    (pick) => {
      countIsDefault.current = false;
      setEvery(String(pick.every));
      setUnit(pick.unit);
      setTouched(true);
    },
  );

  const isCustom = activePreset === "custom";

  const emittedCron = unrepresentable && !touched ? value : cron;
  useOutsideCronSync(value, emittedCron, (pick) => {
    setActivePreset(pick.preset);
    setOptions({ ...DEFAULT_OPTIONS, ...pick.options });
    if (pick.interval) {
      countIsDefault.current = false;
      setEvery(String(pick.interval.every));
      setUnit(pick.interval.unit);
    }
  });

  // While an unrepresentable legacy cron is still untouched, describe the actual
  // saved schedule rather than the placeholder picker state.
  const summary = builderSummary(
    unrepresentable && !touched ? value : null,
    { activePreset, options, everyValid, weeklyValid, pickedCron },
    labels,
    locale,
  );

  return {
    activePreset,
    selectPreset,
    options,
    updateOption,
    intervalEvery,
    setIntervalEvery,
    intervalUnit,
    setIntervalUnit,
    everyValid,
    floorOk,
    stepper,
    isCustom,
    showTime: NEEDS_TIME.includes(activePreset),
    summary,
  };
}
