import { posix } from "node:path";
import {
  type ObjectStore,
  type SyncResult,
  syncBack,
} from "@houston/runtime-client/object-sync";
import type { SeedTree } from "./op-seed-tree";

/**
 * Upload a seeded tree create-only: every key `ifGenerationMatch: "0"`, even
 * though the (empty) listing shows no generations, and only inside the new
 * agent's directory. The store is handed over WITHOUT its listing, so a 412
 * stays a conflict: the sync's refreshed-generation retry would otherwise
 * overwrite the object another seeder just created.
 */
export function syncSeedTree(
  store: ObjectStore,
  prefix: string,
  storeRoot: string,
  tree: SeedTree,
): Promise<SyncResult> {
  const root = `${tree.workspaceRel}/`;
  const createOnly: ObjectStore = {
    list: (p) => store.list(p),
    download: (key, dest, opts) => store.download(key, dest, opts),
    upload: (src, key, opts) => store.upload(src, key, opts),
    delete: (key, opts) => store.delete(key, opts),
  };
  return syncBack(createOnly, prefix, storeRoot, new Map(), {
    include: (rel) => rel.startsWith(root),
    holdDeletesOnFailure: true,
    generations: true,
  });
}

/** Remove this op's create-only uploads after losing a seeding race; an
 *  object someone rewrote since (its generation moved) is theirs and stays. */
export async function withdrawSeedTree(
  store: ObjectStore,
  prefix: string,
  synced: SyncResult,
): Promise<void> {
  for (const rel of synced.uploaded) {
    const generation = synced.manifest.get(rel)?.generation;
    try {
      await store.delete(
        posix.join(prefix, rel),
        generation ? { ifGenerationMatch: generation } : undefined,
      );
    } catch (error) {
      console.warn(
        `[op] seed race: kept ${rel}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
