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
