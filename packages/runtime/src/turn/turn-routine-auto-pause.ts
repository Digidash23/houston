import {
  autoPauseRoutine,
  docKey,
  loadRoutineRuns,
  loadRoutines,
  routineAutoPause,
  saveRoutines,
  upsertById,
} from "@houston/domain";
import type { Routine } from "@houston/protocol";
import type { ObjectStore } from "@houston/runtime-client/object-sync";
import { mutateTurnDocument } from "./turn-doc-cas";
import type { TurnFilesystem } from "./turn-filesystem";

/**
 * The pooled twin of the standing host's pauseFailingRoutines: after a routine
 * run settled as a typed failure, pause the routine when its run history has
 * earned it (domain `routineAutoPause`). The routines doc is written through
 * the same generation-guarded CAS as `save_routine`, so a user edit that
 * landed during the turn is merged, never clobbered, and a resume that landed
 * first moves the count's start past the failures it would have counted. The
 * upload is what stops the schedule: the store projects `enabled` from every
 * routines.json write.
 */
export async function autoPauseRoutineTurn(opts: {
  store: ObjectStore;
  prefix: string;
  filesystem: TurnFilesystem;
  routineId: string;
  nowIso: string;
}): Promise<Routine | null> {
  const { filesystem } = opts;
  const root = filesystem.workspaceRel;
  return mutateTurnDocument<Routine | null>({
    store: opts.store,
    prefix: opts.prefix,
    filesystem,
    relativePath: docKey(root, "routines"),
    shouldCommit: (paused) => paused !== null,
    apply: async () => {
      const { items: routines } = await loadRoutines(filesystem.vfs, root);
      const { items: runs } = await loadRoutineRuns(filesystem.vfs, root);
      const routine = routines.find((r) => r.id === opts.routineId);
      const pause = routine
        ? routineAutoPause(routine, runs, opts.nowIso)
        : null;
      if (!routine || !pause) return null;
      const paused = autoPauseRoutine(routine, pause);
      await saveRoutines(filesystem.vfs, root, upsertById(routines, paused));
      return paused;
    },
  });
}
