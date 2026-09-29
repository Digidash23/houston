import type {
  ProviderError,
  Routine,
  RoutineAutoPause,
  RoutineRun,
  RoutineRunFailure,
  RoutineRunFailureCode,
} from "@houston/protocol";

/**
 * Auto-pause: a routine whose latest runs all failed on the same wall a person
 * has to clear (no account connected, an expired login, no credits left, a
 * model the account cannot run) stops firing until someone resumes it. Every
 * fire is a paid sandbox turn, and a routine firing every minute into a dead
 * credential burns one per minute for nothing.
 *
 * The streak is read off the routine's own run history (routine_runs.json),
 * which both execution paths already write — the standing pod's reconcile and
 * the pooled worker's settle — so no counter lives anywhere else. Pure: the
 * callers own the reads, the write and the clock.
 */

/**
 * Consecutive same-kind user-fixable failures that pause a routine. Picked on
 * 30 days of fleet routine turns (to 2026-09-24): 10 pauses 444 routines and
 * drops 84% of the spend on failed routine turns, 5 would save only 2% more
 * while pausing twice as many routines that later recovered alone (89 vs 45),
 * and 20 lets a daily routine fail for three weeks. It is a count, not a
 * time: a routine firing every minute stops within ten minutes, a daily one
 * after ten days.
 */
export const ROUTINE_AUTO_PAUSE_AFTER = 10;

/** Whose credential ran a failed turn. No acting identity = the creator's own. */
function isTeamCredential(err: ProviderError): boolean {
  return err.credential?.scope === "team";
}

/**
 * The typed failure for a turn's provider error, or undefined when the error
 * is not a wall a person has to clear: a rate limit, an outage, a network
 * blip, an overflowing conversation, a usage window that resets by itself.
 * Those leave the run's story in its summary and never count toward a pause.
 */
export function routineRunFailure(
  err: ProviderError,
): RoutineRunFailure | undefined {
  if (err.kind === "quota_exhausted")
    return { code: "out_of_credits", provider: err.provider };
  if (err.kind === "model_unavailable")
    return { code: "model_unavailable", provider: err.provider };
  if (err.kind !== "unauthenticated") return undefined;
  const team = isTeamCredential(err);
  const code: RoutineRunFailureCode =
    err.cause === "no_credentials"
      ? team
        ? "team_not_connected"
        : "creator_not_connected"
      : team
        ? "team_needs_reconnect"
        : "creator_needs_reconnect";
  return { code, provider: err.provider };
}

const startedMs = (run: RoutineRun): number => {
  const ms = Date.parse(run.started_at);
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * The pause `routine` has earned, or null. Walks the routine's finished runs
 * newest first and counts the streak of errors that share one typed failure:
 * - a run that answered (silent or surfaced) ends the streak — it recovered;
 * - a typed failure of another kind or provider ends it too (a new wall);
 * - an error with no typed failure (a timeout, an outage, a rate limit) and a
 *   run someone stopped neither count nor end it;
 * - runs that started before the routine's last edit are not counted, so
 *   resuming (or fixing the routine's model) starts the count from zero.
 */
export function routineAutoPause(
  routine: Routine,
  runs: RoutineRun[],
  nowIso: string,
): RoutineAutoPause | null {
  if (!routine.enabled || routine.auto_paused) return null;
  const editedMs = Date.parse(routine.updated_at);
  const since = Number.isFinite(editedMs) ? editedMs : 0;
  const finished = runs
    .filter((r) => r.routine_id === routine.id && r.status !== "running")
    .filter((r) => startedMs(r) >= since)
    .sort((a, b) => startedMs(b) - startedMs(a));
  let wall: RoutineRunFailure | undefined;
  let failures = 0;
  for (const run of finished) {
    if (run.status === "cancelled") continue;
    if (run.status !== "error") break;
    if (!run.failure) continue;
    wall ??= run.failure;
    if (
      run.failure.code !== wall.code ||
      run.failure.provider !== wall.provider
    )
      break;
    failures++;
  }
  if (!wall || failures < ROUTINE_AUTO_PAUSE_AFTER) return null;
  return {
    reason: wall.code,
    provider: wall.provider,
    failures,
    at: nowIso,
  };
}

/** The routine, paused by the engine for `pause`. */
export function autoPauseRoutine(
  routine: Routine,
  pause: RoutineAutoPause,
): Routine {
  return {
    ...routine,
    enabled: false,
    auto_paused: pause,
    updated_at: pause.at,
  };
}
