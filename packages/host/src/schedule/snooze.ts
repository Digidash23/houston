import {
  loadRoutines,
  routineSnooze,
  routineSnoozeLogTail,
  saveRoutines,
  snoozeRoutine,
  upsertById,
  withDocLock,
} from "@houston/domain";
import type { Routine, RoutineRun, RoutineRunFailure } from "@houston/protocol";
import type { Agent, Workspace } from "../domain/types";
import type { EventHub } from "../events/hub";
import type { Vfs } from "../vfs";
import { pauseFailingRoutines } from "./auto-pause";

interface WallDeps {
  vfs: Vfs;
  events?: EventHub;
  now: () => Date;
}

/**
 * What follows the runs that just settled on a typed wall: a plan usage
 * limit snoozes its routine until the reset right away (domain
 * `routineSnooze`, one run is proof enough), every other wall feeds the
 * auto-pause streak (`pauseFailingRoutines`). Both write the routines doc, so
 * the snooze lands first and the pause reads what it wrote. Callers must not
 * hold the runs queue (the pause takes it).
 */
export async function settleRoutineWalls(
  deps: WallDeps,
  ws: Workspace,
  agent: Agent,
  root: string,
  walled: readonly RoutineRun[],
): Promise<void> {
  const limited = new Map(
    walled.flatMap((run) =>
      run.failure?.code === "usage_limit"
        ? [[run.routine_id, run.failure] as const]
        : [],
    ),
  );
  if (limited.size > 0)
    await snoozeLimitedRoutines(deps, ws, agent, root, limited);
  const streak = walled
    .filter((run) => run.failure && run.failure.code !== "usage_limit")
    .map((run) => run.routine_id);
  await pauseFailingRoutines(deps, ws, agent, root, streak);
}

/**
 * Snooze each routine in `limited` until its failure's reset, under the same
 * per-doc lock as every other routine write (routes/routine-write.ts), so a
 * concurrent edit is never lost. A routine already snoozed past this reset
 * keeps its longer hold.
 */
export async function snoozeLimitedRoutines(
  deps: WallDeps,
  ws: Workspace,
  agent: Agent,
  root: string,
  limited: ReadonlyMap<
    string,
    Extract<RoutineRunFailure, { code: "usage_limit" }>
  >,
): Promise<Routine[]> {
  const snoozed = await withDocLock(`${root}#routines`, async () => {
    const { items: routines } = await loadRoutines(deps.vfs, root);
    const nowIso = deps.now().toISOString();
    let next = routines;
    const done: Routine[] = [];
    for (const [id, failure] of limited) {
      const routine = routines.find((r) => r.id === id);
      const snooze = routine ? routineSnooze(failure, nowIso) : null;
      if (!routine || !snooze) continue;
      if (routine.snoozed && routine.snoozed.until >= snooze.until) continue;
      const updated = snoozeRoutine(routine, snooze);
      next = upsertById(next, updated);
      done.push(updated);
    }
    if (done.length > 0) await saveRoutines(deps.vfs, root, next);
    return done;
  });
  for (const routine of snoozed) {
    if (routine.snoozed)
      console.info(
        `[routine-snooze] snoozed ${agent.id}/${routine.id}: ${routineSnoozeLogTail(routine.snoozed)}`,
      );
  }
  if (snoozed.length > 0) {
    deps.events?.emit(ws.ownerUserId, {
      type: "RoutinesChanged",
      agentPath: agent.id,
    });
  }
  return snoozed;
}
