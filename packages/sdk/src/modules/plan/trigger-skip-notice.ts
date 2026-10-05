import type {
  PlanSummary,
  TriggerPlanSkipped,
  TriggerStatusItem,
} from "@houston/wire-types";

/**
 * Why a routine's runs were skipped, as the person needs to hear it.
 *
 * - The inactivity pause splits in two because the remedy differs: while
 *   routines are still paused, resuming fixes it; once they run again,
 *   nothing is left to fix and the notice only explains the gap.
 * - The routine limit splits the same way: while routines are paused the
 *   plan's own dialog answers Resume before it lets anyone choose a routine
 *   to keep, so resuming comes first.
 * - `creator_plan`: the gateway judges a fire against the routine CREATOR's
 *   plan, so a viewer who did not create it can only be told whose plan it
 *   was; their own plan, chooser and billing describe something else.
 */
export type TriggerPlanSkipReason =
  | "min_interval"
  | "routine_limit"
  | "routine_limit_paused"
  | "inactive_paused"
  | "inactive_resumed"
  | "creator_plan";

/**
 * What the person can do about it. `upgrade` opens personal Billing,
 * `keep_routine` opens the Free "choose a routine to keep" chooser, `resume`
 * resumes routines paused while away (`resumeRoutines`). Listed in the order
 * a surface offers them, primary first.
 */
export type TriggerPlanSkipAction = "resume" | "keep_routine" | "upgrade";

interface NoticeBase {
  /** The runs refused in the last 24 hours. */
  count: number;
  /** ISO time of the most recent refusal. */
  lastAt: string;
  actions: TriggerPlanSkipAction[];
}

export type TriggerPlanSkipNotice =
  | (NoticeBase & { reason: "min_interval"; minIntervalMinutes: number })
  | (NoticeBase & { reason: Exclude<TriggerPlanSkipReason, "min_interval"> });

/** Who is looking at which routine: the gateway's routine key plus creator. */
export interface TriggerPlanSkipViewer {
  /** The routine's `created_by`; absent when the routine names no creator. */
  createdBy: string | undefined;
  /** The signed-in user's id; null while the session is still loading. */
  viewerId: string | null | undefined;
  /** The agent's slug (a hosted agent's client-side id). */
  agentSlug: string;
  /** The space's org slug, when the caller knows it (team spaces do). */
  orgSlug?: string | null;
}

/** The Free minimum interval when the plan summary does not state one. */
const DEFAULT_MIN_INTERVAL_MINUTES = 15;

/**
 * The notice for a routine whose trigger runs the Free plan refused, or null
 * when there is nothing to say. Webhook and app events the plan refuses are
 * dropped before they become runs, so without this the person sees a routine
 * that silently ignored them.
 *
 * The refusal was decided on the CREATOR's plan. A viewer who is not the
 * creator, or a routine that names no creator, gets the read-only
 * `creator_plan` notice whatever the viewer's own plan is. The creator sees
 * it only while on Free: on Plus (or before the plan has loaded, or without
 * personal plans) the old refusals describe nothing they can act on, and the
 * routine they now keep says nothing about the routine limit.
 */
export function triggerPlanSkipNotice(
  item: TriggerStatusItem | undefined,
  plan: PlanSummary | undefined,
  viewer: TriggerPlanSkipViewer,
): TriggerPlanSkipNotice | null {
  const skipped = item?.plan_skipped;
  if (!item || !skipped || skipped.count < 1 || !knownCode(skipped))
    return null;
  const base = { count: skipped.count, lastAt: skipped.last_at };
  if (!viewer.createdBy)
    return { ...base, reason: "creator_plan", actions: [] };
  // Unknown viewer: wait for the session rather than flash the wrong variant.
  if (!viewer.viewerId) return null;
  if (viewer.createdBy !== viewer.viewerId)
    return { ...base, reason: "creator_plan", actions: [] };
  if (plan?.plan !== "free") return null;

  const paused = plan.routines?.paused === true;
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
      if (isKept(plan, item.routine_id, viewer)) return null;
      return paused
        ? {
            ...base,
            reason: "routine_limit_paused",
            actions: ["resume", "upgrade"],
          }
        : {
            ...base,
            reason: "routine_limit",
            actions: ["keep_routine", "upgrade"],
          };
    case "plan_inactive":
      return paused
        ? { ...base, reason: "inactive_paused", actions: ["resume", "upgrade"] }
        : { ...base, reason: "inactive_resumed", actions: ["upgrade"] };
  }
}

/** A code from a newer gateway: a notice that guessed would name the wrong reason. */
function knownCode(skipped: TriggerPlanSkipped): boolean {
  return (
    skipped.code === "plan_min_interval" ||
    skipped.code === "plan_routine_limit" ||
    skipped.code === "plan_inactive"
  );
}

/**
 * Whether this routine is the one Free keeps, by the gateway's whole key. A
 * stale kept key naming the same routine id under another agent or space must
 * not hide a notice the gateway is still refusing for; the org is compared
 * whenever the caller knows it.
 */
function isKept(
  plan: PlanSummary,
  routineId: string,
  viewer: TriggerPlanSkipViewer,
): boolean {
  const kept = plan.routines?.kept;
  if (!kept) return false;
  return (
    kept.routineId === routineId &&
    kept.agentSlug === viewer.agentSlug &&
    (!viewer.orgSlug || kept.orgSlug === viewer.orgSlug)
  );
}
