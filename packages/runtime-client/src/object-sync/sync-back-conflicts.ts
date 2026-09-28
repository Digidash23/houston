import type { HydrateManifestEntry } from "./hydrate";
import {
  type ObjectStore,
  ObjectTooLargeError,
  StoreConflictError,
  type WriteOptions,
} from "./object-store";
import { isMergedDocument } from "./sync-back-doc-merge";
import { withMergeBase } from "./sync-back-merge-base";
import {
  type ConflictBackoff,
  type RefreshManifest,
  sourceVanished,
  uploadMergedDocument,
} from "./sync-back-merge-retry";

export type { RefreshManifest } from "./sync-back-merge-retry";

/** Result of one upload plus its conflict retries. */
export interface UploadChangeResult {
  entry?: HydrateManifestEntry;
  uploaded: boolean;
  skipped?: string;
  conflict?: string;
  /** The source file was unlinked between the sync scan and the upload read. */
  vanished?: boolean;
  /** Merge rounds a merged document needed after its first 412. */
  mergeAttempts?: number;
}

function initialWriteOptions(
  generationAware: boolean,
  previous: HydrateManifestEntry | undefined,
): WriteOptions | undefined {
  if (!generationAware) return undefined;
  if (previous?.generation !== undefined) {
    return { ifGenerationMatch: previous.generation };
  }
  return previous ? undefined : { ifGenerationMatch: "0" };
}

/**
 * Upload once. On a generation conflict a merged document re-merges against
 * the latest remote for a bounded number of rounds; any other file retries
 * once at the refreshed generation (last writer wins).
 */
export async function uploadChangedObject(opts: {
  store: ObjectStore;
  abs: string;
  key: string;
  relativePath: string;
  hash: string;
  previous?: HydrateManifestEntry;
  generationAware: boolean;
  refresh: RefreshManifest;
  backoff?: ConflictBackoff;
}): Promise<UploadChangeResult> {
  try {
    const result = await opts.store.upload(
      opts.abs,
      opts.key,
      initialWriteOptions(opts.generationAware, opts.previous),
    );
    return {
      entry: await withMergeBase(opts.abs, opts.relativePath, {
        hash: opts.hash,
        generation: result?.generation,
      }),
      uploaded: true,
    };
  } catch (error) {
    if (error instanceof ObjectTooLargeError) {
      return {
        entry: { hash: opts.hash },
        uploaded: false,
        skipped: error.message,
      };
    }
    if (sourceVanished(error)) return { uploaded: false, vanished: true };
    if (!(error instanceof StoreConflictError)) throw error;
    if (isMergedDocument(opts.relativePath)) {
      const { attempts, ...merged } = await uploadMergedDocument({
        ...opts,
        conflict: error.message,
      });
      return { ...merged, mergeAttempts: attempts };
    }
    return overwriteAtRefreshedGeneration(opts, error.message);
  }
}

async function overwriteAtRefreshedGeneration(
  opts: Parameters<typeof uploadChangedObject>[0],
  conflict: string,
): Promise<UploadChangeResult> {
  const refreshed = await opts.refresh();
  const current = refreshed?.get(opts.key);
  const retryGeneration = current ? current.generation : "0";
  if (!refreshed || retryGeneration === undefined) {
    return { entry: opts.previous, uploaded: false, conflict };
  }
  try {
    const result = await opts.store.upload(opts.abs, opts.key, {
      ifGenerationMatch: retryGeneration,
    });
    return {
      entry: await withMergeBase(opts.abs, opts.relativePath, {
        hash: opts.hash,
        generation: result?.generation,
      }),
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

/** Result of one delete plus its optional generation retry. */
export interface DeleteObjectResult {
  deleted: boolean;
  entry?: HydrateManifestEntry;
  conflict?: string;
}

/** Delete once, refreshing and retrying one generation conflict. */
export async function deleteOwnedObject(opts: {
  store: ObjectStore;
  key: string;
  previous: HydrateManifestEntry;
  generationAware: boolean;
  refresh: RefreshManifest;
}): Promise<DeleteObjectResult> {
  const writeOptions =
    opts.generationAware && opts.previous.generation !== undefined
      ? { ifGenerationMatch: opts.previous.generation }
      : undefined;
  try {
    await opts.store.delete(opts.key, writeOptions);
    return { deleted: true };
  } catch (error) {
    if (!(error instanceof StoreConflictError)) throw error;
    const refreshed = await opts.refresh();
    if (!refreshed) {
      return { deleted: false, entry: opts.previous, conflict: error.message };
    }
    const current = refreshed.get(opts.key);
    if (!current) return { deleted: true };
    const retryGeneration = current.generation;
    try {
      await opts.store.delete(
        opts.key,
        retryGeneration === undefined
          ? undefined
          : { ifGenerationMatch: retryGeneration },
      );
      return { deleted: true };
    } catch (retryError) {
      if (!(retryError instanceof StoreConflictError)) throw retryError;
      return {
        deleted: false,
        entry: { ...opts.previous, generation: retryGeneration },
        conflict: retryError.message,
      };
    }
  }
}
