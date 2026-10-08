import { scheduleFloorAllows } from "@houston/domain";
import type { PlanSummary } from "@houston/wire-types";

/** Free's routine floor when the summary omits it. */
const DEFAULT_FREE_MIN_INTERVAL_MINUTES = 15;

/**
 * The minimum minutes between fires a schedule editor may offer, or undefined
 * for no limit: the VIEWER's own plan, on any routine. Every save re-stamps the
 * routine's `created_by` to whoever saved it, and the gateway judges fires
 * against that person's plan, so a Free person's save is held to Free's floor
 * whoever created the routine, and a Plus person's save to none. (The skip
 * notice still reads the stored creator, `triggerPlanSkipNotice`: it explains
 * runs already judged.)
 */
export function routineScheduleFloor(
  plan: PlanSummary | undefined,
): number | undefined {
  if (plan?.plan !== "free") return undefined;
  return plan.routines?.minIntervalMinutes ?? DEFAULT_FREE_MIN_INTERVAL_MINUTES;
}

/**
 * A floor as a schedule editor and its save check bind it: the minimum it
 * names, and the one rule that judges a cron against it. The minutes stepper
 * starts at the lowest count `allows` accepts and Save is judged by `allows`
 * itself, so the picker, the save check and the host's routine-write gate
 * never disagree.
 */
export interface RoutineScheduleFloor {
  minutes: number;
  allows: (cron: string) => boolean;
}

export function scheduleFloorRule(minutes: number): RoutineScheduleFloor {
  return { minutes, allows: (cron) => scheduleFloorAllows(cron, minutes) };
}

/**
 * The rule itself: a cron is judged by its smallest REAL gap between fires.
 * Lives in `@houston/domain` so the host's routine-write gate judges a save
 * by the same function.
 */
export { scheduleFloorAllows };
