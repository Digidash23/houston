import { cn } from "@houston-ai/core";
import { MISSION_TAG_BASE_CLASSES } from "./mission-status-tag";

/**
 * Who started a task, beside its status tag ("Routine", "Started by
 * Houston", "Started by Marisol"): the same words the board card wears, in
 * the neutral chip, because an origin is a fact about the task, never a state
 * that asks for the user. A long employee name truncates instead of pushing
 * the row wider than the screen.
 */
export function MissionOriginTag({ label }: { label: string }) {
  return (
    <span
      data-testid="agent-mission-origin"
      className={cn(MISSION_TAG_BASE_CLASSES, "min-w-0 bg-chip text-chip-text")}
    >
      <span className="truncate leading-4">{label}</span>
    </span>
  );
}
