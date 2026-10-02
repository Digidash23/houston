import type { RoutineRun } from "@houston/protocol";
import { RESUME_MAX_AGE_MS } from "./turn-resume-age";

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
 * clock. While the agent sleeps, the control plane's reconcile op settles it
 * on a pool worker instead. Past the timeout the row stops blocking either
 * way. A row with no readable start can never be shown to be fresh, so it
 * never blocks.
 *
 * A `resumed` run restarted mid-run, and reconcile restarts its clock at the
 * interruption, which the row does not carry. An engine resumes only a turn
 * younger than RESUME_MAX_AGE_MS, so that is the latest the clock restarts.
 */
export function holdsRoutineBusy(run: RoutineRun, nowMs: number): boolean {
  if (run.status !== "running") return false;
  const startedMs = Date.parse(run.started_at);
  if (!Number.isFinite(startedMs)) return false;
  const window = run.resumed
    ? RESUME_MAX_AGE_MS + ROUTINE_RUN_TIMEOUT_MS
    : ROUTINE_RUN_TIMEOUT_MS;
  return nowMs - startedMs < window;
}
