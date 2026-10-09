/**
 * The optimistic shape of a routine RUN write: what a routine row shows the
 * instant "Run now" or "Stop run" is pressed, before the host answers.
 *
 * "Run now" answers with no run id (the host starts the run and reports it
 * through the runs list), so the row paints a placeholder run keyed to the
 * routine. A real running run for the same routine supersedes it, which keeps
 * the patch idempotent across refetches. Stopping the placeholder stops the
 * routine's newest running run, whichever one that turns out to be.
 *
 * Pure + dependency-free (`app/tests/routine-run-optimistic.test.ts`).
 */

import type { RoutineRun } from "@houston/engine-adapter";

const PLACEHOLDER_PREFIX = "optimistic-run:";

/** True for the id of a run painted before the host reported it. */
export function isOptimisticRunId(runId: string): boolean {
  return runId.startsWith(PLACEHOLDER_PREFIX);
}

/** The routine's newest running run, real or placeholder. */
export function latestRunningRunId(
  runs: RoutineRun[] | undefined,
  routineId: string,
): string | undefined {
  let latest: RoutineRun | undefined;
  for (const run of runs ?? []) {
    if (run.routine_id !== routineId || run.status !== "running") continue;
    if (!latest || run.started_at > latest.started_at) latest = run;
  }
  return latest?.id;
}

/** The cached runs with a placeholder running run for `routineId`. */
export function addOptimisticRun(
  runs: RoutineRun[] | undefined,
  routineId: string,
  nowIso: string,
): RoutineRun[] | undefined {
  const id = `${PLACEHOLDER_PREFIX}${routineId}`;
  // Already painted (perhaps stopped since), or the real run is listed.
  if (!runs || runs.some((run) => run.id === id)) return runs;
  if (latestRunningRunId(runs, routineId)) return runs;
  return [
    ...runs,
    {
      id,
      routine_id: routineId,
      status: "running",
      session_key: "",
      started_at: nowIso,
    },
  ];
}

/**
 * The cached runs with a stopped run painted as cancelled. A placeholder id
 * names the routine's newest running run instead, so the stop still lands on
 * the real run once the host has reported it.
 */
export function markRunCancelled(
  runs: RoutineRun[] | undefined,
  routineId: string,
  runId: string,
  nowIso: string,
): RoutineRun[] | undefined {
  // This stop's own stamp: already painted, so a second pass is a no-op
  // rather than a stop of the routine's NEXT running run.
  const painted = runs?.some(
    (run) =>
      run.routine_id === routineId &&
      run.status === "cancelled" &&
      run.completed_at === nowIso,
  );
  if (painted) return runs;
  const target = isOptimisticRunId(runId)
    ? latestRunningRunId(runs, routineId)
    : runId;
  if (!runs || !target) return runs;
  return runs.map((run) =>
    run.id === target && run.status === "running"
      ? { ...run, status: "cancelled", completed_at: nowIso }
      : run,
  );
}
