/**
 * "Repeat every [N] [unit]" — the non-technical custom-interval picker, styled
 * after the chosen prototype (Variant A): a number stepper plus a row of unit
 * pills (minute / hour / day / month). Every unit takes a count.
 *
 * All visible text arrives via props so the package stays i18n-agnostic; the
 * pills show the singular or plural unit name depending on the count. With a
 * `floor` (a plan's minimum interval, minutes unit only) the minus/plus buttons
 * jump between the counts it offers and a typed count snaps up on blur.
 */
import { cn } from "@houston-ai/core";
import { Minus, Plus } from "lucide-react";
import type { FloorStepper } from "./schedule-floor";
import type { IntervalUnit } from "./schedule-interval-utils";
import { labelClass } from "./schedule-picker-fields";

const UNIT_ORDER: IntervalUnit[] = ["minutes", "hours", "days", "months"];

function NumberStepper({
  id,
  value,
  onChange,
  invalid,
  decreaseLabel,
  increaseLabel,
  floor,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  decreaseLabel: string;
  increaseLabel: string;
  floor?: FloorStepper;
}) {
  const n = Number(value) || 1;
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border bg-input transition-opacity",
        invalid ? "border-danger-ring" : "border-line/20",
      )}
    >
      <button
        type="button"
        aria-label={decreaseLabel}
        onClick={
          floor
            ? () => floor.down?.()
            : () => onChange(String(Math.max(1, n - 1)))
        }
        disabled={floor ? floor.down === null : n <= 1}
        className="grid size-9 place-items-center text-ink-muted hover:text-ink disabled:opacity-30"
      >
        <Minus className="size-4" />
      </button>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value}
        // Keep digits only; an empty string is allowed (and flagged invalid) so
        // it can be cleared while typing.
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={floor?.commit}
        className="w-10 bg-transparent text-center text-sm tabular-nums outline-none disabled:cursor-not-allowed"
      />
      <button
        type="button"
        aria-label={increaseLabel}
        onClick={floor ? () => floor.up?.() : () => onChange(String(n + 1))}
        disabled={floor ? floor.up === null : undefined}
        className="grid size-9 place-items-center text-ink-muted hover:text-ink disabled:opacity-30"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export function IntervalPicker({
  label,
  units,
  unitsSingular,
  decreaseLabel,
  increaseLabel,
  every,
  unit,
  invalid,
  floor,
  onEveryChange,
  onUnitChange,
}: {
  label: string;
  units: Record<IntervalUnit, string>;
  unitsSingular: Record<IntervalUnit, string>;
  decreaseLabel: string;
  increaseLabel: string;
  every: string;
  unit: IntervalUnit;
  invalid?: boolean;
  /** Floor stepping for the minutes count; absent = step by one. */
  floor?: FloorStepper;
  onEveryChange: (every: string) => void;
  onUnitChange: (unit: IntervalUnit) => void;
}) {
  const plural = Number(every) > 1;
  const inputId = "interval-picker-every";
  return (
    <div>
      <label htmlFor={inputId} className={labelClass}>
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <NumberStepper
          id={inputId}
          value={every}
          onChange={onEveryChange}
          invalid={invalid}
          floor={floor}
          decreaseLabel={decreaseLabel}
          increaseLabel={increaseLabel}
        />
        <div className="flex flex-wrap gap-1.5">
          {UNIT_ORDER.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => onUnitChange(u)}
              className={cn(
                "h-9 rounded-full px-3 text-xs font-medium transition-colors",
                unit === u
                  ? "bg-action text-action-text"
                  : "bg-input border border-line/20 text-ink-muted hover:text-ink",
              )}
            >
              {plural ? units[u] : unitsSingular[u]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
