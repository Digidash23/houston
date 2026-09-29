import {
  autoPauseRoutine,
  loadRoutineRuns,
  loadRoutines,
  routineAutoPause,
  saveRoutines,
  upsertById,
  withDocLock,
} from "@houston/domain";
import type { Routine } from "@houston/protocol";
import type { Agent, Workspace } from "../domain/types";
import type { EventHub } from "../events/hub";
import type { Vfs } from "../vfs";
import { withRunsFile } from "./runs-lock";

/**
 * Pause each of `routineIds` whose run history has earned it (domain
 * `routineAutoPause`): called right after a run of theirs failed on a typed
 * wall, from the reconcile sweep and from a fire the runtime refused. The
 * routines read → save pair runs under the same per-doc lock as every other
 * routine write (routes/routine-write.ts), so a concurrent edit is never lost
 * and an edit that landed first (a resume, a model change) moves the count's
 * start past the failures it would have counted. Callers must not hold the
 * runs queue (it is not reentrant).
 */
export async function pauseFailingRoutines(
  deps: { vfs: Vfs; events?: EventHub; now: () => Date },
  ws: Workspace,
  agent: Agent,
  root: string,
  routineIds: string[],
): Promise<Routine[]> {
  if (routineIds.length === 0) return [];
  // Runs queue first, then the routines doc (the one lock order): no run can
  // settle between the streak read and the pause save.
  const paused = await withRunsFile(root, () =>
    withDocLock(`${root}#routines`, async () => {
      const { items: runs } = await loadRoutineRuns(deps.vfs, root);
      const { items: routines } = await loadRoutines(deps.vfs, root);
      const nowIso = deps.now().toISOString();
      let next = routines;
      const done: Routine[] = [];
      for (const id of new Set(routineIds)) {
        const routine = routines.find((r) => r.id === id);
        const pause = routine ? routineAutoPause(routine, runs, nowIso) : null;
        if (!routine || !pause) continue;
        const updated = autoPauseRoutine(routine, pause);
        next = upsertById(next, updated);
        done.push(updated);
      }
      if (done.length > 0) await saveRoutines(deps.vfs, root, next);
      return done;
    }),
  );
  for (const routine of paused) {
    console.info(
      `[routine-auto-pause] paused ${agent.id}/${routine.id} after ${routine.auto_paused?.failures} runs: ${routine.auto_paused?.reason} (${routine.auto_paused?.provider})`,
    );
  }
  if (paused.length > 0) {
    deps.events?.emit(ws.ownerUserId, {
      type: "RoutinesChanged",
      agentPath: agent.id,
    });
  }
  return paused;
}
