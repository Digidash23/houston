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
  routineSnooze,
  saveRoutines,
  snoozeRoutine,
  upsertById,
} from "@houston/domain";
import {
  atomicTempPath,
  type Routine,
  type RoutineRunFailure,
} from "@houston/protocol";
import {
  ObjectNotFoundError,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";
import { mutateTurnDocument } from "./turn-doc-cas";
import type { TurnFilesystem } from "./turn-filesystem";
import { fsTextStore } from "./turn-fs-store";

interface RoutineMutationOpts {
  store: ObjectStore;
  prefix: string;
  filesystem: TurnFilesystem;
  routineId: string;
  nowIso: string;
}

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
export async function autoPauseRoutineTurn(
  opts: RoutineMutationOpts,
): Promise<Routine | null> {
  return mutateRoutine(opts, async (routine) => {
    // The runs file exactly as settleRoutineTurn just wrote it on disk.
    const { items: runs } = await loadRoutineRuns(
      fsTextStore(),
      opts.filesystem.workspaceDir,
    );
    const pause = routineAutoPause(routine, runs, opts.nowIso);
    return pause ? autoPauseRoutine(routine, pause) : null;
  });
}

/**
 * The pooled twin of the standing host's snoozeLimitedRoutines: hold the
 * routine's fires until the plan usage limit its run hit resets (domain
 * `routineSnooze`). The store projects `snoozed.until` from the upload the
 * same way it projects `enabled`, so the cloud planner skips the fires too.
 */
export async function snoozeRoutineTurn(
  opts: RoutineMutationOpts & {
    failure: Extract<RoutineRunFailure, { code: "usage_limit" }>;
  },
): Promise<Routine | null> {
  return mutateRoutine(opts, async (routine) => {
    const snooze = routineSnooze(opts.failure, opts.nowIso);
    if (!snooze) return null;
    if (routine.snoozed && routine.snoozed.until >= snooze.until) return null;
    return snoozeRoutine(routine, snooze);
  });
}

/** One CAS write of the store's routines doc with `routine` replaced by what
 *  `change` returns; null from `change` (or a routine gone) commits nothing. */
async function mutateRoutine(
  opts: RoutineMutationOpts,
  change: (routine: Routine) => Promise<Routine | null>,
): Promise<Routine | null> {
  const { filesystem } = opts;
  const root = filesystem.workspaceRel;
  const relativePath = docKey(root, "routines");
  return mutateTurnDocument<Routine | null>({
    store: opts.store,
    prefix: opts.prefix,
    filesystem,
    relativePath,
    shouldCommit: (changed) => changed !== null,
    apply: async () => {
      const routines = await remoteRoutines(opts, relativePath);
      const routine = routines?.find((r) => r.id === opts.routineId);
      if (!routines || !routine) return null;
      const changed = await change(routine);
      if (!changed) return null;
      await saveRoutines(filesystem.vfs, root, upsertById(routines, changed));
      return changed;
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
