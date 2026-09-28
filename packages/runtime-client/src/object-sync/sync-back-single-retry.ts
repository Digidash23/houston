import { randomUUID } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { atomicTempPath } from "@houston/protocol";
import { fileSha256 } from "./file-hash";
import type { HydrateManifestEntry } from "./hydrate";
import { type ObjectStore, StoreConflictError } from "./object-store";
import {
  mergeDocumentBodies,
  mergesOnceOnConflict,
} from "./sync-back-doc-merge";
import { type RefreshManifest, sourceVanished } from "./sync-back-merge-retry";

/**
 * The standing store sync's generation-conflict retry, unchanged from before
 * the per-turn worker's merge rounds (`sync-back-merge-retry.ts`): refresh the
 * listing, merge routines/learnings/custom integrations into the remote once
 * (the board is never merged here: it re-uploads, last writer wins), and
 * upload once at the refreshed generation. A second conflict is recorded.
 */
export async function retryAtRefreshedGeneration(
  opts: {
    store: ObjectStore;
    abs: string;
    key: string;
    relativePath: string;
    hash: string;
    previous?: HydrateManifestEntry;
    refresh: RefreshManifest;
  },
  conflict: string,
): Promise<{
  entry?: HydrateManifestEntry;
  uploaded: boolean;
  conflict?: string;
  vanished?: boolean;
}> {
  const refreshed = await opts.refresh();
  if (!refreshed) return { entry: opts.previous, uploaded: false, conflict };
  const current = refreshed.get(opts.key);
  const retryGeneration = current ? current.generation : "0";
  if (retryGeneration === undefined) {
    return { entry: opts.previous, uploaded: false, conflict };
  }
  try {
    const mergedHash = await mergeSyncBackDocument(opts);
    const result = await opts.store.upload(opts.abs, opts.key, {
      ifGenerationMatch: retryGeneration,
    });
    return {
      entry: { hash: mergedHash ?? opts.hash, generation: result?.generation },
      uploaded: true,
    };
  } catch (retryError) {
    if (sourceVanished(retryError)) return { uploaded: false, vanished: true };
    if (!(retryError instanceof StoreConflictError)) throw retryError;
    return {
      entry: opts.previous
        ? { ...opts.previous, generation: retryGeneration }
        : undefined,
      uploaded: false,
      conflict: retryError.message,
    };
  }
}

/** Merge a conflict-sensitive document and replace its local copy. */
async function mergeSyncBackDocument(opts: {
  store: ObjectStore;
  abs: string;
  key: string;
  relativePath: string;
}): Promise<string | undefined> {
  if (!mergesOnceOnConflict(opts.relativePath)) return undefined;
  const localBody = await readFile(opts.abs, "utf8");
  const remoteTemp = atomicTempPath(opts.abs, `${randomUUID()}.remote`);
  try {
    await opts.store.download(opts.key, remoteTemp);
    const remoteBody = await readFile(remoteTemp, "utf8");
    const merged = mergeDocumentBodies(
      opts.relativePath,
      localBody,
      remoteBody,
    );
    if (merged === undefined) return undefined;
    await writeFile(opts.abs, merged);
    const { size } = await stat(opts.abs);
    return fileSha256(opts.abs, size);
  } finally {
    await rm(remoteTemp, { force: true });
  }
}
