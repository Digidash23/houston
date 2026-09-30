import type { RoutineRun } from "@houston/protocol";

/**
 * How long a routine run may stay `running` before it counts as abandoned.
 * The standing host's reconcile errors a reply-less run past it; the pooled
 * worker's busy gate stops letting such a row hold its routine.
 */
export const ROUTINE_RUN_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Whether `run` still holds its routine busy at `nowMs`: `running`, and
 * started less than ROUTINE_RUN_TIMEOUT_MS ago. The pooled worker's gate
 * only: a pooled run's row reaches the store settled (sync-back runs after
 * the settle), so a `running` row it hydrates is a settle that failed or a
 * standing pod's run, which that pod's reconcile times out on this same
 * clock. Nothing settles either while the agent sleeps, so past the timeout
 * the row stops blocking; its status is left for reconcile. A row with no
 * readable start can never be shown to be fresh, so it never blocks.
 */
export function holdsRoutineBusy(run: RoutineRun, nowMs: number): boolean {
  if (run.status !== "running") return false;
  const startedMs = Date.parse(run.started_at);
  return (
    Number.isFinite(startedMs) && nowMs - startedMs < ROUTINE_RUN_TIMEOUT_MS
  );
}
