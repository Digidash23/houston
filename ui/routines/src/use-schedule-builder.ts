/**
 * State and effects for ScheduleBuilder, kept separate from the JSX so each
 * file stays small. What the state MEANS (the schedule it writes, validity, the
 * summary) is derived purely in `./schedule-builder-output`.
 */
import { useEffect, useRef, useState } from "react";
import { DEFAULT_SCHEDULE_LABELS, type ScheduleLabels } from "./labels";
import {
  builderEmits,
  builderOutput,
  builderSummary,
} from "./schedule-builder-output";
import {
  cronToOptions,
  cronToPreset,
  type ScheduleOptions,
} from "./schedule-cron-utils";
import {
  type IntervalUnit,
  intervalCountMax,
  scheduleToInterval,
} from "./schedule-interval-utils";
import type { SchedulePreset } from "./types";

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
  /** The largest count the current unit takes. */
  intervalMax: number;
  everyValid: boolean;
  isCustom: boolean;
  showTime: boolean;
  summary: string;
}

export function useScheduleBuilder(
  value: string,
  onChange: (cronExpression: string) => void,
  labels: ScheduleLabels = DEFAULT_SCHEDULE_LABELS,
  locale = "en-US",
): ScheduleBuilderState {
  // Detect initial preset/interval from the incoming schedule.
  const detectedPreset = cronToPreset(value);
  const detectedInterval =
    detectedPreset === "custom" ? scheduleToInterval(value) : null;

  // Until the person changes something, the builder writes nothing back (see
  // builderEmits): opening the editor never rewrites a saved schedule, whether
  // the picker can't represent it (a weekday range) or would spell it anew (a
  // legacy `*\/16` the picker now writes as `@every 16m`).
  // Counts real edits: every one re-emits, even when the schedule string comes
  // out the same, so an edit always replaces an outside value it can't show.
  const [edits, setEdits] = useState(0);
  const touched = edits > 0;
  const edited = () => setEdits((n) => n + 1);

  const [activePreset, setActivePreset] = useState<SchedulePreset>(
    detectedPreset ?? "daily",
  );
  const [options, setOptions] = useState<ScheduleOptions>({
    ...DEFAULT_OPTIONS,
    ...cronToOptions(value),
  });
  // The interval count is held as a string so the field can be cleared fully
  // while typing (e.g. to replace "1" with "984"); "" means no valid number.
  const [intervalEvery, setEvery] = useState(
    detectedInterval ? String(detectedInterval.every) : "5",
  );
  const [intervalUnit, setUnit] = useState<IntervalUnit>(
    detectedInterval ? detectedInterval.unit : "minutes",
  );

  const pick = { activePreset, options, intervalEvery, intervalUnit };
  const output = builderOutput(pick);

  // Stable ref for onChange to avoid infinite effect loops.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Emit the schedule when the pick changes. An invalid pick emits "" so the
  // parent's save validation can block saving.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` gates only the very first emit (an empty seed) and `edits` is the re-emit trigger; re-running on `value` would echo every keystroke back
  useEffect(() => {
    if (!builderEmits(touched, value)) return;
    onChangeRef.current(output.schedule);
  }, [output.schedule, edits]);

  // Setters mark the builder touched only on a real change, so re-clicking the
  // current preset or unit is not an edit and Save stays a no-op.
  const selectPreset = (preset: SchedulePreset) => {
    if (preset === activePreset) return;
    setActivePreset(preset);
    edited();
  };
  const updateOption = (patch: Partial<ScheduleOptions>) => {
    const keys = Object.keys(patch) as (keyof ScheduleOptions)[];
    if (keys.every((k) => String(patch[k]) === String(options[k]))) return;
    setOptions((prev) => ({ ...prev, ...patch }));
    edited();
  };
  const setIntervalEvery = (every: string) => {
    if (every === intervalEvery) return;
    setEvery(every);
    edited();
  };
  const setIntervalUnit = (unit: IntervalUnit) => {
    if (unit === intervalUnit) return;
    setUnit(unit);
    edited();
  };

  // Re-derive the picker when the schedule changes OUTSIDE this builder — the
  // setup chat's agent editing the open routine (HOU-725). Without this the
  // saved schedule and the "next run" preview move while the preset/time
  // fields keep showing the old values. A `value` equal to what the current
  // state emits is our own echo through the parent — skipped, so mid-edit
  // typing never resets the fields.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync on the incoming value only — `output.schedule` is derived from the state this effect sets, and reacting to it would fight the user's edits
  useEffect(() => {
    if (!value.trim() || value === output.schedule) return;
    const preset = cronToPreset(value);
    const interval = preset === "custom" ? scheduleToInterval(value) : null;
    // An externally-written schedule the picker can't represent: leave the
    // state alone — the value prop still drives the summary and saving.
    if (preset === "custom" && !interval) return;
    setActivePreset(preset ?? "daily");
    setOptions({ ...DEFAULT_OPTIONS, ...cronToOptions(value) });
    if (interval) {
      setEvery(String(interval.every));
      setUnit(interval.unit);
    }
  }, [value]);

  return {
    activePreset,
    selectPreset,
    options,
    updateOption,
    intervalEvery,
    setIntervalEvery,
    intervalUnit,
    setIntervalUnit,
    intervalMax: intervalCountMax(intervalUnit),
    everyValid: output.everyValid,
    isCustom: activePreset === "custom",
    showTime: NEEDS_TIME.includes(activePreset),
    summary: builderSummary(pick, output, { touched, value }, labels, locale),
  };
}
