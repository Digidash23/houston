import { stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { fileSha256 } from "./file-hash";
import { DEFAULT_EXCLUDES, excluded, type HydrateManifest } from "./hydrate";
import type { ObjectMetadata } from "./object-manifest";
import type { ObjectStore } from "./object-store";
import { deleteOwnedObject, uploadChangedObject } from "./sync-back-conflicts";
import type { SyncBackOptions, SyncResult } from "./sync-back-types";
import { walkFiles } from "./sync-back-walk";

export type { SyncBackOptions, SyncMerge, SyncResult } from "./sync-back-types";

/** Upload changes and conditionally remove objects owned by the prior hydrate. */
export async function syncBack(
  store: ObjectStore,
  prefix: string,
  dir: string,
  manifest: HydrateManifest,
  opts: SyncBackOptions = {},
): Promise<SyncResult> {
  const excludes = opts.excludes ?? DEFAULT_EXCLUDES;
  // opts.generations is the gateway's explicit capability signal (the boot
  // lease response advertises whether the blob backend supports generation
  // preconditions). It matters exactly where inference cannot work: an empty
  // manifest has no generations to observe, so without the signal a cold
  // agent must write unconditionally and concurrent first creates are
  // last-writer-wins — while sending create-only "0" blindly would 501 on
  // generation-less HTTP backends. Old gateways omit the field; fall back to
  // inferring capability from observed generations.
  const generationAware =
    opts.generations ??
    [...manifest.values()].some(({ generation }) => generation !== undefined);
  const uploaded: string[] = [];
  const skipped: SyncResult["skipped"] = [];
  const conflicts: SyncResult["conflicts"] = [];
  const merges: SyncResult["merges"] = [];
  const nextManifest: HydrateManifest = new Map();
  let outOfScope = 0;
  let refreshed: Promise<Map<string, ObjectMetadata>> | undefined;
  const refresh = (fresh = false) => {
    if (!store.manifest) return undefined;
    if (fresh) refreshed = undefined;
    refreshed ??= store
      .manifest(prefix)
      .then(
        (objects) => new Map(objects.map((object) => [object.key, object])),
      );
    return refreshed;
  };
  let totalBytes = 0;

  for (const rel of await walkFiles(dir, dir)) {
    if (excluded(rel, excludes)) continue;
    const abs = join(dir, ...rel.split("/"));
    // The agent keeps writing during a sync pass, so a walked file may vanish
    // before it is read (runtime session files are rewritten constantly). A
    // vanished file is indistinguishable from one deleted before the walk:
    // leave it out of the next manifest and let the delete pass reconcile the
    // store, instead of aborting the whole pass mid-upload.
    let hash: string;
    let size: number;
    try {
      const fileStat = await stat(abs);
      if (!fileStat.isFile()) continue;
      size = fileStat.size;
      hash = await fileSha256(abs, size);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    totalBytes += size;
    const previous = manifest.get(rel);
    if (opts.include && !opts.include(rel)) {
      // Out of the caller's write scope: never uploaded, but still counted
      // toward the next hydration and kept in the manifest as it was.
      if (previous?.hash !== hash) outOfScope += 1;
      if (previous) nextManifest.set(rel, previous);
      continue;
    }
    if (previous?.hash === hash) {
      nextManifest.set(rel, previous);
      continue;
    }

    const key = prefix ? posix.join(prefix, rel) : rel;
    const result = await uploadChangedObject({
      store,
      abs,
      key,
      relativePath: rel,
      hash,
      previous,
      generationAware,
      refresh,
      ...(opts.workerMerge ? { workerMerge: true } : {}),
      ...(opts.conflictBackoff ? { backoff: opts.conflictBackoff } : {}),
    });
    if (result.mergeAttempts)
      merges.push({
        key: rel,
        attempts: result.mergeAttempts,
        ...(result.removedCards ? { removedCards: result.removedCards } : {}),
        ...(result.unmergeable ? { unmergeable: result.unmergeable } : {}),
      });
    // Second half of the vanish window: the file outlived the hash above but
    // was unlinked before the upload re-read it. Same reconciliation as the
    // walk-stage skip: out of the next manifest, delete pass settles the store.
    if (result.vanished) {
      totalBytes -= size;
      continue;
    }
    if (result.entry) nextManifest.set(rel, result.entry);
    if (result.uploaded) uploaded.push(rel);
    if (result.skipped) skipped.push({ key: rel, reason: result.skipped });
    if (result.conflict) conflicts.push({ key: rel, reason: result.conflict });
  }

  const deleted: string[] = [];
  const holdDeletes =
    opts.holdDeletesOnFailure === true &&
    (skipped.length > 0 || conflicts.length > 0);
  for (const [rel, previous] of manifest) {
    if (nextManifest.has(rel)) continue;
    if (holdDeletes) {
      // Keep the prior entry so the object stays owned and durable.
      nextManifest.set(rel, previous);
      continue;
    }
    if (opts.include && !opts.include(rel)) {
      nextManifest.set(rel, previous);
      outOfScope += 1;
      continue;
    }
    const key = prefix ? posix.join(prefix, rel) : rel;
    const result = await deleteOwnedObject({
      store,
      key,
      previous,
      generationAware,
      refresh,
    });
    if (result.deleted) deleted.push(rel);
    if (result.entry) nextManifest.set(rel, result.entry);
    if (result.conflict) conflicts.push({ key: rel, reason: result.conflict });
  }
  return {
    uploaded,
    deleted,
    skipped,
    conflicts,
    merges,
    outOfScope,
    manifest: nextManifest,
    totalBytes,
  };
}
