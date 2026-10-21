import { cn } from "@houston-ai/core";
import type { ReactNode } from "react";

/**
 * The briefing's one bright element: its primary action, a full-width pill.
 * Its label follows the pick instantly: arrowing through the radios would
 * replay any swap animation on every key. A label too long for a narrow
 * phone grows the pill a line rather than spilling out of it. Kept apart
 * from the frame so a step renders without the frame's stylesheet, which
 * styles the `plan-briefing-*` classes.
 */
export function PlanBriefingCta({
  label,
  disabled = false,
  onClick,
}: {
  label: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="plan-briefing-cta plan-briefing-press flex min-h-12 w-full items-center justify-center rounded-full bg-ink px-6 py-3 text-base font-medium text-balance text-dialog outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
    >
      {label}
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
