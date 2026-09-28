import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { normalizeActivities, parseJsonDoc } from "@houston/domain";
import { atomicTempPath } from "@houston/protocol";
import type { ObjectStore } from "@houston/runtime-client/object-sync";
import { type TurnFilesystem, turnActivityKey } from "./turn-filesystem";

/** Where the durable board object lives, for a re-read after a lost race. */
export interface ActivityDocSource {
  store: ObjectStore;
  prefix: string;
}

function activityPath(filesystem: TurnFilesystem): string {
  return join(filesystem.workspaceDir, ".houston", "activity", "activity.json");
}

// Same tolerant parse as every other doc reader (BOM strip + salvage), so the
// pooled path publishes exactly what the standing projector would.
function activityDoc(raw: string, key: string) {
  return normalizeActivities(parseJsonDoc(raw, key), key).items;
}

/** The board as this turn's sync-back left it on disk. */
export async function readLocalActivityDoc(filesystem: TurnFilesystem) {
  const key = turnActivityKey(filesystem.workspaceRel);
  return activityDoc(await readFile(activityPath(filesystem), "utf8"), key);
}

/**
 * The board as the object store holds it now (another writer may have landed
 * after this turn's upload). Undefined when it cannot be read: the caller
 * skips rather than projecting a copy it knows is stale.
 */
export async function readStoredActivityDoc(
  source: ActivityDocSource,
  filesystem: TurnFilesystem,
) {
  const rel = turnActivityKey(filesystem.workspaceRel);
  const key = source.prefix ? posix.join(source.prefix, rel) : rel;
  const temp = atomicTempPath(
    activityPath(filesystem),
    `${randomUUID()}.latest`,
  );
  try {
    await source.store.download(key, temp);
    return activityDoc(await readFile(temp, "utf8"), rel);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[turn] activity_doc_publish_skipped reason=stale_after_conflict read_failed=${JSON.stringify(reason)}`,
    );
    return undefined;
  } finally {
    await rm(temp, { force: true });
  }
}
