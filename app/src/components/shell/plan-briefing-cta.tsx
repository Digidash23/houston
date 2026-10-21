import { cn } from "@houston-ai/core";
import type { ReactNode } from "react";
import { useSwapped } from "./plan-briefing-swap";

/**
 * The briefing's one bright element: its primary action, a full-width pill.
 * A label that changes (the picker's "Keep La Fila free") swaps in with a
 * short blur. Kept apart from the frame so a step renders without the frame's
 * stylesheet, which styles the `plan-briefing-*` classes.
 */
export function PlanBriefingCta({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const swapped = useSwapped(label);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="plan-briefing-cta plan-briefing-press h-12 w-full rounded-full bg-ink text-base font-medium text-dialog outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
    >
      <span key={label} className={swapped ? "plan-briefing-label" : undefined}>
        {label}
      </span>
    </button>
  );
}

/** The briefing's quiet way out ("Maybe later"), under its primary action. */
export function PlanBriefingQuietButton({
  onClick,
  disabled = false,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "plan-briefing-quiet plan-briefing-press mt-4 self-center rounded-full px-4 py-2 text-sm text-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}
