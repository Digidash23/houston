import { normalizeActivities, parseJsonDoc } from "@houston/domain";
import type { ObjectStore } from "@houston/runtime-client/object-sync";
import { type TurnFilesystem, turnActivityKey } from "./turn-filesystem";
import { readStoreText } from "./turn-store-read";

/** Where the durable board object lives, for a re-read after a lost race. */
export interface ActivityDocSource {
  store: ObjectStore;
  prefix: string;
}

// Same tolerant parse as every other doc reader (BOM strip + salvage), so the
// pooled path publishes exactly what the standing projector would.
function activityDoc(raw: string, key: string) {
  return normalizeActivities(parseJsonDoc(raw, key), key).items;
}

/**
 * The board as the object store holds it now (another writer may have landed
 * after this turn's upload). Undefined when it is gone or cannot be read in
 * time: the caller skips rather than projecting a copy it may know to be
 * stale.
 */
export async function readStoredActivityDoc(
  source: ActivityDocSource,
  filesystem: TurnFilesystem,
) {
  const rel = turnActivityKey(filesystem.workspaceRel);
  try {
    const raw = await readStoreText(source, rel);
    if (raw !== null) return activityDoc(raw, rel);
    console.warn(
      '[turn] activity_doc_publish_skipped reason=stale_after_conflict read_failed="gone"',
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[turn] activity_doc_publish_skipped reason=stale_after_conflict read_failed=${JSON.stringify(reason)}`,
    );
  }
  return undefined;
}
