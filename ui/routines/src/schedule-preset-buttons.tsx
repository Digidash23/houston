/**
 * The ScheduleBuilder's preset pills (every 30 minutes, hourly, daily, …).
 * With a `minIntervalMinutes` floor, a preset that fires more often than the
 * floor is not offered at all.
 */
import { cn } from "@houston-ai/core";
import { presetAllowed } from "./schedule-floor";
import type { SchedulePreset } from "./types";

export function SchedulePresetButtons({
  presets,
  active,
  labels,
  minIntervalMinutes,
  onSelect,
}: {
  presets: SchedulePreset[];
  active: SchedulePreset;
  labels: Record<SchedulePreset, string>;
  minIntervalMinutes?: number;
  onSelect: (preset: SchedulePreset) => void;
}) {
  const shown =
    minIntervalMinutes === undefined
      ? presets
      : presets.filter((preset) => presetAllowed(preset, minIntervalMinutes));
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((preset) => (
        <button
          type="button"
          key={preset}
          onClick={() => onSelect(preset)}
          className={cn(
            "h-8 px-3 rounded-full text-xs font-medium transition-colors",
            active === preset
              ? "bg-action text-action-text"
              : "bg-input border border-ink/[0.04] text-ink-muted hover:text-ink",
          )}
        >
          {labels[preset]}
        </button>
      ))}
    </div>
  );
}
