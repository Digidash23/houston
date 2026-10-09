import type {
  Routine,
  RoutineRun,
  RoutineRunFailure,
  RoutineSnooze,
} from "@houston/protocol";

/**
 * Snooze: the engine's hold on a routine whose run hit a plan usage limit
 * (`RoutineRunFailure.code === "usage_limit"`). The wall clears by itself at
 * the provider's reset, so unlike an auto-pause nobody has to resume it and
 * nothing has to count: one such run is proof enough, and every fire until
 * the reset would only buy another failed sandbox turn (a 5-minute routine
 * made 188 of them into one 4-day limit, H-004). `enabled` stays true so the
 * hold expires by the clock with no writer involved. Pure: callers own the
 * reads, the write and the clock.
 */

/**
 * How long a snooze lasts when the provider named no reset (or one already
 * behind us). An hour bounds the waste to twelve fires a day for a 5-minute
 * routine while still re-learning the truth the same day a short window
 * clears.
 */
export const USAGE_LIMIT_UNKNOWN_RESET_MS = 60 * 60 * 1000;

/**
 * The longest a snooze may hold. Anthropic's longest window is a week; a
 * reset further out is a misread (an epoch in the wrong unit, a garbled
 * sentence), and holding a routine for months on one would be silent.
 */
export const USAGE_LIMIT_MAX_SNOOZE_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * The snooze a failed run earns, or null when its failure is not a usage
 * limit. `until` is the provider's reset when it is a real future instant,
 * else `now` plus the bounded wait.
 */
export function routineSnooze(
  failure: RoutineRunFailure,
  nowIso: string,
): RoutineSnooze | null {
  if (failure.code !== "usage_limit") return null;
  const nowMs = Date.parse(nowIso);
  const resetMs = failure.resets_at ? Date.parse(failure.resets_at) : NaN;
  const until =
    Number.isFinite(resetMs) && resetMs > nowMs
      ? new Date(Math.min(resetMs, nowMs + USAGE_LIMIT_MAX_SNOOZE_MS))
      : new Date(nowMs + USAGE_LIMIT_UNKNOWN_RESET_MS);
  return {
    reason: "usage_limit",
    provider: failure.provider,
    model: failure.model,
    until: until.toISOString(),
    at: nowIso,
  };
}

/**
 * The routine with its fires held. `updated_at` is left alone on purpose: it
 * is the auto-pause streak's start, and a snooze is not an edit.
 */
export function snoozeRoutine(
  routine: Routine,
  snooze: RoutineSnooze,
): Routine {
  return { ...routine, snoozed: snooze };
}

/**
 * The snooze `run` earns `routine` at `nowIso`, or null when it earns none:
 *
 * - only a usage-limit failure snoozes;
 * - only a scheduled routine: the snooze gates the cron scanners (dueAt, the
 *   cloud planner), never a trigger routine's external events, so a trigger
 *   routine is never marked as held;
 * - only a run on the creator's own account (`actingSub` is the run's acting
 *   user, or undefined on a path that always runs as the creator): a "Run
 *   now" on someone else's account says nothing about the schedule's;
 * - only while the run still describes the routine: an edit after the run
 *   started, or a model or provider that no longer matches the failure,
 *   means the limit may not apply any more;
 * - an existing hold that lasts longer is kept.
 */
export function snoozeAfterRun(
  routine: Routine,
  run: RoutineRun,
  nowIso: string,
  actingSub?: string | null,
): RoutineSnooze | null {
  const failure = run.failure;
  if (failure?.code !== "usage_limit") return null;
  if (!routine.schedule || !routine.enabled) return null;
  if (actingSub !== undefined && (routine.created_by ?? null) !== actingSub)
    return null;
  if (Date.parse(routine.updated_at) > Date.parse(run.started_at)) return null;
  if (routine.provider && routine.provider !== failure.provider) return null;
  if (routine.model && failure.model && routine.model !== failure.model)
    return null;
  const snooze = routineSnooze(failure, nowIso);
  if (!snooze || (routine.snoozed && routine.snoozed.until >= snooze.until))
    return null;
  return snooze;
}

/**
 * The routine with its snooze lifted after a run that answered (silent or
 * surfaced) on the creator's account, or null when there is nothing to lift.
 * The run proved the limit is over; holding on would skip good fires.
 */
export function unsnoozeAfterRun(
  routine: Routine,
  run: RoutineRun,
  actingSub?: string | null,
): Routine | null {
  if (!routine.snoozed) return null;
  if (run.status !== "silent" && run.status !== "surfaced") return null;
  if (actingSub !== undefined && (routine.created_by ?? null) !== actingSub)
    return null;
  const { snoozed: _lifted, ...rest } = routine;
  return rest;
}

/** The log line's tail for a snooze: "<reason> (<provider> <model>) until <iso>". */
export function routineSnoozeLogTail(snooze: RoutineSnooze): string {
  const model = snooze.model ? ` ${snooze.model}` : "";
  return `${snooze.reason} (${snooze.provider}${model}) until ${snooze.until}`;
}
