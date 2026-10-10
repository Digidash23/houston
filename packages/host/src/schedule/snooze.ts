import {
  loadRoutines,
  routineSnoozeLogTail,
  saveRoutines,
  snoozeAfterRun,
  snoozeRoutine,
  unsnoozeAfterRun,
  upsertById,
  withDocLock,
} from "@houston/domain";
import type { Routine, RoutineRun } from "@houston/protocol";
import type { Agent, Workspace } from "../domain/types";
import type { EventHub } from "../events/hub";
import type { Vfs } from "../vfs";
import { pauseFailingRoutines } from "./auto-pause";

interface SettleDeps {
  vfs: Vfs;
  events?: EventHub;
  now: () => Date;
}

/**
 * What follows the runs that just settled: a plan usage limit snoozes its
 * routine until the reset right away (domain `snoozeAfterRun`, one run is
 * proof enough), a run that answered lifts a snooze (`unsnoozeAfterRun`),
 * and every other typed wall feeds the auto-pause streak
 * (`pauseFailingRoutines`). Both write the routines doc, so the snooze lands
 * first and the pause reads what it wrote. Callers must not hold the runs
 * queue (the pause takes it). A host run row names no acting user: a
 * scheduled fire runs as the creator, but a "Run now" runs as whoever
 * pressed it (routes/routine-runs.ts), so a manual row neither snoozes nor
 * lifts (domain snoozeAfterRun / unsnoozeAfterRun).
 */
export async function settleRoutineRuns(
  deps: SettleDeps,
  ws: Workspace,
  agent: Agent,
  root: string,
  settled: readonly RoutineRun[],
): Promise<void> {
  if (settled.some((r) => r.failure?.code === "usage_limit" || isAnswer(r)))
    await snoozeOrLift(deps, ws, agent, root, settled);
  const streak = settled
    .filter((run) => run.failure && run.failure.code !== "usage_limit")
    .map((run) => run.routine_id);
  await pauseFailingRoutines(deps, ws, agent, root, streak);
}

const isAnswer = (run: RoutineRun) =>
  run.status === "silent" || run.status === "surfaced";

/**
 * Snooze or lift each settled run's routine, under the same per-doc lock as
 * every other routine write (routes/routine-write.ts), so a concurrent edit
 * is never lost.
 */
async function snoozeOrLift(
  deps: SettleDeps,
  ws: Workspace,
  agent: Agent,
  root: string,
  settled: readonly RoutineRun[],
): Promise<void> {
  const changed = await withDocLock(`${root}#routines`, async () => {
    const { items: routines } = await loadRoutines(deps.vfs, root);
    const nowIso = deps.now().toISOString();
    let next = routines;
    const done: Routine[] = [];
    for (const run of settled) {
      const routine = next.find((r) => r.id === run.routine_id);
      if (!routine) continue;
      const snooze = snoozeAfterRun(routine, run, nowIso);
      const updated = snooze
        ? snoozeRoutine(routine, snooze)
        : unsnoozeAfterRun(routine, run);
      if (!updated) continue;
      next = upsertById(next, updated);
      done.push(updated);
    }
    if (done.length > 0) await saveRoutines(deps.vfs, root, next);
    return done;
  });
  for (const routine of changed) {
    console.info(
      routine.snoozed
        ? `[routine-snooze] snoozed ${agent.id}/${routine.id}: ${routineSnoozeLogTail(routine.snoozed)}`
        : `[routine-snooze] lifted ${agent.id}/${routine.id}: a run answered`,
    );
  }
  if (changed.length > 0) {
    deps.events?.emit(ws.ownerUserId, {
      type: "RoutinesChanged",
      agentPath: agent.id,
    });
  }
}
