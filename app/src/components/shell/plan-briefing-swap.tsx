import { cn } from "@houston-ai/core";
import { type ReactNode, useState } from "react";

/**
 * True once `key` has changed since the first render. A briefing animates a
 * step or a label that changes, never the one it opens on: the frame's own
 * entrance already covers that.
 */
export function useSwapped(key: string): boolean {
  const [seen, setSeen] = useState({ key, swapped: false });
  if (seen.key !== key) {
    setSeen({ key, swapped: true });
    return true;
  }
  return seen.swapped;
}

/**
 * One step of a briefing. A new step remounts under its key, so its entrance
 * replays on every change, Back included. On a phone the step fills the
 * sheet, so an `mt-auto` action block sits at the bottom.
 */
export function BriefingStep({
  step,
  children,
}: {
  step: string;
  children: ReactNode;
}) {
  const swapped = useSwapped(step);
  return (
    <div
      key={step}
      className={cn("flex flex-1 flex-col", swapped && "plan-briefing-step")}
    >
      {children}
    </div>
  );
}
