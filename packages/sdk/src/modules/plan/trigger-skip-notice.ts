import type { PlanSummary, TriggerStatusItem } from "@houston/wire-types";

/**
 * Why a routine's events were skipped, as the person needs to hear it. The
 * inactivity pause splits in two because the remedy differs: while routines
 * are still paused, resuming fixes it; once they run again, nothing is left
 * to fix and the notice only explains the gap in the history.
 */
export type TriggerPlanSkipReason =
  | "min_interval"
  | "routine_limit"
  | "inactive_paused"
  | "inactive_resumed";

/**
 * What the person can do about it. `upgrade` opens personal Billing,
 * `keep_routine` opens the Free "choose a routine to keep" chooser, `resume`
 * resumes routines paused while away (`resumeRoutines`). Listed in the order
 * a surface offers them, primary first.
 */
export type TriggerPlanSkipAction = "resume" | "keep_routine" | "upgrade";

interface NoticeBase {
  /** The events refused in the last 24 hours. */
  count: number;
  /** ISO time of the most recent refusal. */
  lastAt: string;
  actions: TriggerPlanSkipAction[];
}

export type TriggerPlanSkipNotice =
  | (NoticeBase & { reason: "min_interval"; minIntervalMinutes: number })
  | (NoticeBase & {
      reason: "routine_limit" | "inactive_paused" | "inactive_resumed";
    });

/** The Free minimum interval when the plan summary does not state one. */
const DEFAULT_MIN_INTERVAL_MINUTES = 15;

/**
 * The notice for a routine whose trigger events the Free plan refused, or null
 * when there is nothing to say. Webhook and app events the plan refuses are
 * dropped before they become runs, so without this the person sees a routine
 * that silently ignored them.
 *
 * Shown only to a person on Free: on Plus (or before the plan has loaded, or
 * on a deployment without personal plans) the old refusals no longer describe
 * anything they can act on. A routine the person has since chosen to keep
 * says nothing about the routine limit for the same reason.
 */
export function triggerPlanSkipNotice(
  item: TriggerStatusItem | undefined,
  plan: PlanSummary | undefined,
): TriggerPlanSkipNotice | null {
  const skipped = item?.plan_skipped;
  if (plan?.plan !== "free" || !skipped || skipped.count < 1) return null;
  const base = { count: skipped.count, lastAt: skipped.last_at };
  switch (skipped.code) {
    case "plan_min_interval":
      return {
        ...base,
        reason: "min_interval",
        minIntervalMinutes:
          plan.routines?.minIntervalMinutes ?? DEFAULT_MIN_INTERVAL_MINUTES,
        actions: ["upgrade"],
      };
    case "plan_routine_limit":
      if (plan.routines?.kept?.routineId === item?.routine_id) return null;
      return {
        ...base,
        reason: "routine_limit",
        actions: ["keep_routine", "upgrade"],
      };
    case "plan_inactive":
      return plan.routines?.paused
        ? { ...base, reason: "inactive_paused", actions: ["resume", "upgrade"] }
        : { ...base, reason: "inactive_resumed", actions: ["upgrade"] };
    default:
      // A code from a newer gateway: the parser already drops it, and a
      // notice that guessed would name the wrong reason.
      return null;
  }
}
