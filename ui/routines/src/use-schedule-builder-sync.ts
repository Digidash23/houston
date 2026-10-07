/**
 * Keeps ScheduleBuilder's own state in step with the two inputs that can
 * change after it opens: the cron `value` (edited outside the builder) and the
 * plan's floor (it loads after the editor opens). Split out of
 * useScheduleBuilder to keep that hook small.
 */
import { type MutableRefObject, useEffect, useMemo } from "react";
import { cronToOptions, cronToPreset } from "./schedule-cron-utils";
import {
  defaultMinutesCount,
  floorMinuteCounts,
  type ScheduleFloor,
} from "./schedule-floor";
import { cronToInterval } from "./schedule-interval-utils";

/** What an outside cron re-derives the picker to. */
export interface OutsidePick {
  preset: ReturnType<typeof cronToPreset> & string;
  options: ReturnType<typeof cronToOptions>;
  interval: ReturnType<typeof cronToInterval>;
}

/**
 * Re-derive the picker when the cron changes OUTSIDE this builder — the
 * setup chat's agent editing the open routine (HOU-725). Without this the
 * saved schedule and the "next run" preview move while the preset/time fields
 * keep showing the old values. A `value` equal to what the current state
 * emits (`emittedCron`) is our own echo through the parent — skipped, so
 * mid-edit typing never resets the fields. The re-derived state round-trips
 * to `value`, so the emit effect's follow-up call is a no-op echo.
 */
export function useOutsideCronSync(
  value: string,
  emittedCron: string,
  apply: (pick: OutsidePick) => void,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync on the incoming value only — `emittedCron` is derived from the state this effect sets, and reacting to it would fight the user's edits
  useEffect(() => {
    if (!value.trim() || value === emittedCron) return;
    const preset = cronToPreset(value);
    const interval = preset === "custom" ? cronToInterval(value) : null;
    // An externally-written cron the picker can't represent: leave the state
    // alone (same stance as the mount-time `unrepresentable` guard) — the
    // value prop still drives the summary elsewhere and saving.
    if (preset === "custom" && !interval) return;
    apply({
      preset: preset ?? "daily",
      options: cronToOptions(value),
      interval,
    });
  }, [value]);
}

/**
 * The minute counts the floor's rule accepts. The caller keeps `floor` stable
 * (memoized on its minutes), so the scan runs when the plan changes, not on
 * every render.
 */
export function useFloorMinuteCounts(
  floor: ScheduleFloor | undefined,
): number[] | undefined {
  return useMemo(() => (floor ? floorMinuteCounts(floor) : undefined), [floor]);
}

/**
 * While the count is still the builder's own default (not read from `value`,
 * not edited, unit untouched), a floor that arrives late moves it onto an
 * offered count. A count read from a saved cron stays as it is.
 */
export function useLateFloorDefault(
  minuteCounts: number[] | undefined,
  countIsDefault: MutableRefObject<boolean>,
  setEvery: (update: (every: string) => string) => void,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to the floor arriving; the ref and setter are stable
  useEffect(() => {
    if (!countIsDefault.current || !minuteCounts) return;
    setEvery((every) =>
      minuteCounts.includes(Number(every))
        ? every
        : String(defaultMinutesCount(minuteCounts)),
    );
  }, [minuteCounts]);
}
