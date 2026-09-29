import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import {
  autoPauseRoutine,
  docKey,
  loadRoutineRuns,
  normalizeRoutines,
  parseJsonDoc,
  routineAutoPause,
  saveRoutines,
  upsertById,
} from "@houston/domain";
import { atomicTempPath, type Routine } from "@houston/protocol";
import {
  ObjectNotFoundError,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";
import { mutateTurnDocument } from "./turn-doc-cas";
import type { TurnFilesystem } from "./turn-filesystem";
import { fsTextStore } from "./turn-fs-store";

/**
 * The pooled twin of the standing host's pauseFailingRoutines: after a routine
 * run settled as a typed failure, pause the routine when its run history has
 * earned it (domain `routineAutoPause`). The upload is what stops the
 * schedule: the store projects `enabled` from every routines.json write.
 *
 * The mutation is rebased on the STORE's routines doc, not the tree's copy:
 * the CAS refresh merges local entries over remote ones by id, so a routine
 * the person renamed, re-pinned, resumed or deleted while this turn ran would
 * come back as the stale hydrated entry. Reading the remote doc inside the
 * CAS attempt keeps every other routine and every field of this one as it is
 * now; a routine gone from the store is never paused back into existence.
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
  const relativePath = docKey(root, "routines");
  return mutateTurnDocument<Routine | null>({
    store: opts.store,
    prefix: opts.prefix,
    filesystem,
    relativePath,
    shouldCommit: (paused) => paused !== null,
    apply: async () => {
      const routines = await remoteRoutines(opts, relativePath);
      const routine = routines?.find((r) => r.id === opts.routineId);
      if (!routines || !routine) return null;
      // The runs file exactly as settleRoutineTurn just wrote it on disk.
      const { items: runs } = await loadRoutineRuns(
        fsTextStore(),
        filesystem.workspaceDir,
      );
      const pause = routineAutoPause(routine, runs, opts.nowIso);
      if (!pause) return null;
      const paused = autoPauseRoutine(routine, pause);
      await saveRoutines(filesystem.vfs, root, upsertById(routines, paused));
      return paused;
    },
  });
}

/** The store's current routines, or null when the doc does not exist. */
async function remoteRoutines(
  opts: { store: ObjectStore; prefix: string; filesystem: TurnFilesystem },
  relativePath: string,
): Promise<Routine[] | null> {
  const key = opts.prefix
    ? posix.join(opts.prefix, relativePath)
    : relativePath;
  const temp = atomicTempPath(
    join(opts.filesystem.storeRoot, ...relativePath.split("/")),
    `${randomUUID()}.pause`,
  );
  try {
    await opts.store.download(key, temp);
    return normalizeRoutines(
      parseJsonDoc(await readFile(temp, "utf8"), key),
      key,
    ).items;
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return null;
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
}
