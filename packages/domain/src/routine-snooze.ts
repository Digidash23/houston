import type {
  Routine,
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
      ? new Date(resetMs).toISOString()
      : new Date(nowMs + USAGE_LIMIT_UNKNOWN_RESET_MS).toISOString();
  return {
    reason: "usage_limit",
    provider: failure.provider,
    model: failure.model,
    until,
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

/** The snooze still holding `routine`'s fires at `now`, or null. */
export function activeRoutineSnooze(
  routine: Pick<Routine, "enabled" | "snoozed">,
  now: Date,
): RoutineSnooze | null {
  const snooze = routine.snoozed;
  if (!routine.enabled || !snooze) return null;
  const untilMs = Date.parse(snooze.until);
  return Number.isFinite(untilMs) && untilMs > now.getTime() ? snooze : null;
}

/** The log line's tail for a snooze: "<reason> (<provider> <model>) until <iso>". */
export function routineSnoozeLogTail(snooze: RoutineSnooze): string {
  const model = snooze.model ? ` ${snooze.model}` : "";
  return `${snooze.reason} (${snooze.provider}${model}) until ${snooze.until}`;
}
