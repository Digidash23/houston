import { minFireGapMinutes } from "@houston/domain";
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

/** A minute-step cron, `*\/N * * * *`: what the editor's custom minutes count writes. */
const MINUTE_STEP = /^\*\/(\d+) \* \* \* \*$/;

/**
 * Whether `cron` respects `floor` (from `routineScheduleFloor`), the save
 * backstop that agrees with the editor: a minute step is judged by its nominal
 * N, anything else by its smallest real gap. Cosmetic: the gateway decides.
 */
export function scheduleFloorAllows(
  cron: string,
  floor: number | undefined,
): boolean {
  if (floor === undefined) return true;
  // `*\/16` restarts at the top of the hour (:48 then :00); the gateway judges
  // real fire times, so it may skip the run that lands under the floor there.
  const step = cron.trim().match(MINUTE_STEP);
  if (step) return Number(step[1]) >= floor;
  const gap = minFireGapMinutes(cron);
  return gap === null || gap >= floor;
}
