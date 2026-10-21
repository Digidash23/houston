import { cn } from "@houston-ai/core";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * True once `key` has changed since the first render. A briefing animates a
 * step that changes, never the one it opens on: the frame's own entrance
 * already covers that.
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
  const lastInput = useRef<"keyboard" | "pointer">("pointer");
  return (
    <StepBody key={step} swapped={swapped} lastInput={lastInput}>
      {children}
    </StepBody>
  );
}

/**
 * The control that moved the step unmounts with the old one, so a swapped-in
 * step takes focus on its checked radio, else its title (`tabIndex={-1}`).
 * The ring shows only when a key moved it: a click on the autofocused first
 * action would otherwise hand its keyboard-style focus to the next step. The
 * step a frame opens on leaves focus to the dialog's own autofocus.
 */
function StepBody({
  swapped,
  lastInput,
  children,
}: {
  swapped: boolean;
  lastInput: RefObject<"keyboard" | "pointer">;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!swapped || !ref.current) return;
    const target =
      ref.current.querySelector<HTMLElement>('input[type="radio"]:checked') ??
      ref.current.querySelector<HTMLElement>("h2[tabindex]");
    target?.focus({ focusVisible: lastInput.current === "keyboard" });
  }, [swapped, lastInput]);
  return (
    <div
      ref={ref}
      onKeyDownCapture={() => {
        lastInput.current = "keyboard";
      }}
      onPointerDownCapture={() => {
        lastInput.current = "pointer";
      }}
      className={cn("flex flex-1 flex-col", swapped && "plan-briefing-step")}
    >
      {children}
    </div>
  );
}
