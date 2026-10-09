import type {
  RoutineDeliveryFailure,
  RoutineRunFailure,
} from "./routine-failure";

/** Run-history cap per routine — matches the Rust engine's MAX_RUNS_PER_ROUTINE. */
export const MAX_RUNS_PER_ROUTINE = 50;

/**
 * Cap the run history at MAX_RUNS_PER_ROUTINE per routine, dropping the oldest.
 * Items are stored newest-first (the writer prepends), so "oldest" is simply
 * everything past the cap for that routine_id.
 */
export function pruneRoutineRuns<T extends { routine_id: string }>(
  items: T[],
): T[] {
  const kept = new Map<string, number>();
  return items.filter((run) => {
    const n = (kept.get(run.routine_id) ?? 0) + 1;
    kept.set(run.routine_id, n);
    return n <= MAX_RUNS_PER_ROUTINE;
  });
}

export type RoutineRunStatus =
  | "running"
  | "silent"
  | "surfaced"
  | "error"
  | "cancelled";

export interface RoutineRun {
  id: string;
  routine_id: string;
  status: RoutineRunStatus;
  session_key: string;
  activity_id?: string;
  summary?: string;
  started_at: string;
  completed_at?: string;
  /** Human-readable reset hint while a run sleeps on a usage-limit window. */
  paused_until?: string;
  /**
   * The typed credential-level reason an errored run failed. Additive and
   * optional: other failures after a run starts (a timeout, a provider
   * outage) carry only `summary`, exactly as before.
   */
  failure?: RoutineRunFailure;
  /**
   * Cloud never started the run: no worker took the fire before its max age,
   * or the routine's creator can no longer use the agent. Written by the
   * control plane, never by the engine; it is never paired with `failure` and
   * never feeds the auto-pause streak. A client that does not know the code
   * shows `summary`.
   */
  delivery_failure?: RoutineDeliveryFailure;
  /**
   * The engine restarted mid-run and is running the turn again by itself
   * (PRODUCT-1785). The run stays `running` — its reply is still coming — and
   * this only records that the elapsed time includes a restart, so a reader
   * knows why the run took longer than the routine usually does.
   */
  resumed?: true;
  /**
   * Started by hand ("Run now"), as whoever pressed it, not by the schedule
   * as the routine's creator. Absent on scheduled runs and on rows written
   * before the field existed.
   */
  manual?: true;
}

export interface RoutineRunUpdate {
  status?: RoutineRunStatus;
  activity_id?: string;
  summary?: string;
  completed_at?: string;
  paused_until?: string | null;
  resumed?: true;
}
