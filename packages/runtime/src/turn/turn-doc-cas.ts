import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { atomicTempPath } from "@houston/protocol";
import {
  fileSha256,
  keepsMergeBase,
  mergeDocumentBodies,
  ObjectNotFoundError,
  type ObjectStore,
  StoreConflictError,
  trustedBase,
  withMergeBase,
} from "@houston/runtime-client/object-sync";
import { restoreTurnDocument, snapshotTurnDocument } from "./turn-doc-state";
import type { TurnFilesystem } from "./turn-filesystem";

const MAX_ATTEMPTS = 3;

/** A document remained concurrently modified across every bounded CAS attempt. */
export class TurnDocConflictError extends Error {
  readonly code = "document_conflict";

  constructor(readonly relativePath: string) {
    super(`document changed during this turn: ${relativePath}`);
    this.name = "TurnDocConflictError";
  }
}

/** Dependencies and mutation callback for one guarded document write. */
export interface TurnDocCasOptions<T> {
  store: ObjectStore;
  prefix: string;
  filesystem: TurnFilesystem;
  relativePath: string;
  apply: () => Promise<T>;
  shouldCommit?: (result: T) => boolean;
}

function remoteKey(prefix: string, relativePath: string): string {
  return prefix ? posix.join(prefix, relativePath) : relativePath;
}

async function refreshDocument<T>(
  opts: TurnDocCasOptions<T>,
): Promise<{ generation?: string; refreshable: boolean }> {
  const key = remoteKey(opts.prefix, opts.relativePath);
  const local = join(
    opts.filesystem.storeRoot,
    ...opts.relativePath.split("/"),
  );
  let localBody: string | undefined;
  try {
    localBody = await readFile(local, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let generation: string | undefined;
  const versionedRead = opts.store.downloadVersioned !== undefined;
  const remoteTemp = atomicTempPath(local, `${randomUUID()}.remote`);
  try {
    if (opts.store.downloadVersioned) {
      generation = (await opts.store.downloadVersioned(key, remoteTemp))
        .generation;
    } else if (opts.store.manifest) {
      const object = (await opts.store.manifest(opts.prefix)).find(
        (entry) => entry.key === key,
      );
      if (!object) {
        opts.filesystem.manifest.delete(opts.relativePath);
        return { refreshable: true };
      }
      generation = object.generation;
      await opts.store.download(key, remoteTemp);
    } else {
      return {
        generation: opts.filesystem.manifest.get(opts.relativePath)?.generation,
        refreshable: false,
      };
    }
  } catch (error) {
    await rm(remoteTemp, { force: true });
    if (!(error instanceof ObjectNotFoundError)) throw error;
    opts.filesystem.manifest.delete(opts.relativePath);
    return { refreshable: true };
  }
  let remoteText: string | undefined;
  try {
    await mkdir(dirname(local), { recursive: true });
    if (localBody !== undefined) {
      remoteText = await readFile(remoteTemp, "utf8");
      // Three-way against the bytes this turn last synced: a routine the
      // turn never touched takes the store's copy, and one another writer
      // deleted stays deleted.
      const merged = mergeDocumentBodies(
        opts.relativePath,
        localBody,
        remoteText,
        trustedBase(opts.filesystem.manifest.get(opts.relativePath)),
      );
      await writeFile(local, merged ?? remoteText);
    } else {
      await writeFile(local, await readFile(remoteTemp));
      if (keepsMergeBase(opts.relativePath))
        remoteText = await readFile(local, "utf8");
    }
  } finally {
    await rm(remoteTemp, { force: true });
  }
  const info = await stat(local);
  opts.filesystem.manifest.set(opts.relativePath, {
    hash: await fileSha256(local, info.size),
    generation,
    // The store's bytes at `generation`: trusted as the next attempt's base
    // only while the local copy still equals them (trustedBase).
    ...(remoteText !== undefined && keepsMergeBase(opts.relativePath)
      ? { mergeBase: remoteText }
      : {}),
  });
  return {
    generation,
    refreshable: !versionedRead || generation !== undefined,
  };
}

/** Re-read, re-apply, and generation-guard one document mutation up to three times. */
export async function mutateTurnDocument<T>(
  opts: TurnDocCasOptions<T>,
): Promise<T> {
  const key = remoteKey(opts.prefix, opts.relativePath);
  const local = join(
    opts.filesystem.storeRoot,
    ...opts.relativePath.split("/"),
  );
  const original = await snapshotTurnDocument(
    opts.filesystem,
    opts.relativePath,
    local,
  );
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const refreshed = await refreshDocument(opts);
      const beforeAttempt = await snapshotTurnDocument(
        opts.filesystem,
        opts.relativePath,
        local,
      );
      const result = await opts.apply();
      if (opts.shouldCommit && !opts.shouldCommit(result)) {
        await restoreTurnDocument(
          opts.filesystem,
          opts.relativePath,
          local,
          original,
        );
        return result;
      }
      const info = await stat(local);
      try {
        const uploaded = await opts.store.upload(local, key, {
          ifGenerationMatch: refreshed.generation ?? "0",
        });
        opts.filesystem.manifest.set(
          opts.relativePath,
          await withMergeBase(local, opts.relativePath, {
            hash: await fileSha256(local, info.size),
            generation: uploaded?.generation ?? refreshed.generation,
          }),
        );
        opts.filesystem.immediateWrites.add(opts.relativePath);
        return result;
      } catch (error) {
        if (!(error instanceof StoreConflictError)) throw error;
        await restoreTurnDocument(
          opts.filesystem,
          opts.relativePath,
          local,
          beforeAttempt,
        );
        if (!refreshed.refreshable) break;
      }
    }
    throw new TurnDocConflictError(opts.relativePath);
  } catch (error) {
    await restoreTurnDocument(
      opts.filesystem,
      opts.relativePath,
      local,
      original,
    );
    throw error;
  }
}
