/**
 * "Repeat every [N] [unit]" — the non-technical custom-interval picker, styled
 * after the chosen prototype (Variant A): a number stepper plus a row of unit
 * pills (minute / hour / day / month). Every unit takes a count.
 *
 * All visible text arrives via props so the package stays i18n-agnostic; the
 * pills show the singular or plural unit name depending on the count. A `min`
 * (a plan's minimum, minutes unit only) keeps the stepper at or above it and
 * snaps a lower typed count up to it on blur.
 */
import { cn } from "@houston-ai/core";
import { Minus, Plus } from "lucide-react";
import type { MouseEvent } from "react";
import {
  stepperBlurSnap,
  stepperCanDecrease,
  stepperDecrease,
  stepperIncrease,
} from "./schedule-floor";
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
  min,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  decreaseLabel: string;
  increaseLabel: string;
  min?: number;
}) {
  const n = Number(value) || 1;
  // Under a floor a button press must not blur the field first: the blur snap
  // would land on the floor and plus would then step one past it. Keeping
  // focus works in WebKit too, where a clicked button never takes focus.
  const keepFocus =
    min === undefined ? undefined : (e: MouseEvent) => e.preventDefault();
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
        onMouseDown={keepFocus}
        onClick={() => onChange(String(stepperDecrease(n, min)))}
        disabled={!stepperCanDecrease(n, min)}
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
        onBlur={
          min === undefined
            ? undefined
            : () => {
                const snapped = stepperBlurSnap(value, min);
                if (snapped !== null) onChange(snapped);
              }
        }
        className="w-10 bg-transparent text-center text-sm tabular-nums outline-none disabled:cursor-not-allowed"
      />
      <button
        type="button"
        aria-label={increaseLabel}
        onMouseDown={keepFocus}
        onClick={() => onChange(String(stepperIncrease(n, min)))}
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
  min,
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
  /** Lowest count the stepper offers; absent = 1. */
  min?: number;
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
          min={min}
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
