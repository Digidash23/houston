import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { atomicTempPath } from "@houston/protocol";
import {
  keepsMergeBase,
  mergeDocumentBodies,
  mergeOverDeleted,
  ObjectNotFoundError,
  type ObjectStore,
  trustedBase,
} from "@houston/runtime-client/object-sync";
import type { TurnFilesystem } from "./turn-filesystem";

/** One document a turn writes straight to the store. */
export interface DocRefreshTarget {
  store: ObjectStore;
  prefix: string;
  filesystem: TurnFilesystem;
  relativePath: string;
}

/**
 * Bring the turn's copy of one document up to what the store holds now,
 * before a guarded write: merged three-way against the bytes the turn last
 * synced, with the manifest entry naming the store's bytes and generation.
 */
export function remoteKey(prefix: string, relativePath: string): string {
  return prefix ? posix.join(prefix, relativePath) : relativePath;
}

export async function refreshDocument(
  opts: DocRefreshTarget,
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
  // Another writer deleted the whole document: the entries this turn only
  // hydrated go with it, its own additions stay (a local copy that will not
  // merge recreates it, as before).
  const gone = async () => {
    const base = trustedBase(opts.filesystem.manifest.get(opts.relativePath));
    if (localBody !== undefined) {
      try {
        const merged = mergeOverDeleted(opts.relativePath, localBody, base);
        if (merged !== undefined) await writeFile(local, merged);
      } catch (error) {
        console.warn(
          `[turn-doc-cas] ${opts.relativePath} unmergeable over its deletion, local copy kept: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    opts.filesystem.manifest.delete(opts.relativePath);
    return { refreshable: true };
  };
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
      if (!object) return gone();
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
    return gone();
  }
  let remote: Buffer;
  try {
    remote = await readFile(remoteTemp);
    await mkdir(dirname(local), { recursive: true });
    // Three-way against the bytes this turn last synced: an entry the turn
    // never touched takes the store's copy, one another writer deleted stays
    // deleted, and the turn's own unsynced changes stay on top.
    const merged =
      localBody === undefined
        ? undefined
        : mergeDocumentBodies(
            opts.relativePath,
            localBody,
            remote.toString("utf8"),
            trustedBase(opts.filesystem.manifest.get(opts.relativePath)),
          );
    await writeFile(local, merged ?? remote);
  } finally {
    await rm(remoteTemp, { force: true });
  }
  // The entry names the STORE's bytes at `generation`, never the merged local
  // copy: a lost upload retries from it, and only then is it a trusted base.
  opts.filesystem.manifest.set(opts.relativePath, {
    hash: createHash("sha256").update(remote).digest("hex"),
    generation,
    ...(keepsMergeBase(opts.relativePath)
      ? { mergeBase: remote.toString("utf8") }
      : {}),
  });
  return {
    generation,
    refreshable: !versionedRead || generation !== undefined,
  };
}
