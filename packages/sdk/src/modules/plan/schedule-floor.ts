import type { PlanSummary } from "@houston/wire-types";

/** Free's routine floor when the summary omits it. */
const DEFAULT_FREE_MIN_INTERVAL_MINUTES = 15;

/** Who is editing which routine's schedule. */
export interface RoutineScheduleViewer {
  /** The routine's `created_by`; absent when the routine names no creator. */
  createdBy: string | undefined;
  /** The signed-in user's id; null/undefined while the session is loading. */
  viewerId: string | null | undefined;
}

/**
 * The minimum minutes between fires a schedule editor may offer for this
 * routine, or undefined for no limit. The gateway judges a routine's fires
 * against its CREATOR's plan (as `triggerPlanSkipNotice` does), so the viewer's
 * own plan only describes routines they created: a floor applies only when the
 * viewer is the creator and on Free. Another person's routine, or either id
 * unknown, gets no floor, since the viewer's plan says nothing about it.
 */
export function routineScheduleFloor(
  plan: PlanSummary | undefined,
  viewer: RoutineScheduleViewer,
): number | undefined {
  if (!viewer.createdBy || !viewer.viewerId) return undefined;
  if (viewer.createdBy !== viewer.viewerId) return undefined;
  if (plan?.plan !== "free") return undefined;
  return plan.routines?.minIntervalMinutes ?? DEFAULT_FREE_MIN_INTERVAL_MINUTES;
}

/**
 * The save backstop that agrees with the editor (`routineScheduleFloor` gives
 * the floor). Lives in `@houston/domain` so the host's routine-write gate
 * judges an agent's save by the same rule.
 */
export { scheduleFloorAllows } from "@houston/domain";
