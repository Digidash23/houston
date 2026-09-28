import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { atomicTempPath } from "@houston/protocol";
import type { HydrateManifestEntry } from "./hydrate";
import { type ObjectStore, StoreConflictError } from "./object-store";
import { mergeDocumentBodies, removedCardIds } from "./sync-back-doc-merge";
import { trustedBase, withMergeBase } from "./sync-back-merge-base";
import {
  type RefreshManifest,
  readRemoteDocument,
} from "./sync-back-remote-read";

export type { RefreshManifest } from "./sync-back-remote-read";

/** Refresh+merge+upload rounds a merged document gets after its first 412. */
export const MERGE_UPLOAD_ATTEMPTS = 6;

/** Delay before merge round `retry` (1-based: the round after the first). */
export type ConflictBackoff = (retry: number) => number;

/**
 * 50, 100, 200, 400, 800 ms, each scaled by a random 0.5-1.5. Several turns
 * finishing on one board together would otherwise re-collide in lockstep.
 */
export const jitteredConflictBackoff: ConflictBackoff = (retry) =>
  Math.round(Math.min(800, 50 * 2 ** (retry - 1)) * (0.5 + Math.random()));

/** Outcome of the merge loop; `attempts` counts merge rounds run. */
export interface MergedUploadResult {
  entry?: HydrateManifestEntry;
  uploaded: boolean;
  conflict?: string;
  vanished?: boolean;
  attempts: number;
  /** Board card ids the remote held that the landed merge does not. */
  removedCards?: string[];
}

/**
 * Land a merged document (the board, routines, learnings, custom
 * integrations) after its first upload lost a generation race. Every round
 * re-reads the remote and merges the turn's ORIGINAL bytes into it from
 * scratch, never an earlier round's output: a card another writer deleted
 * between rounds stays deleted, and a two-way merge never pins an entry at a
 * stale remote copy. Concurrent turns on one agent plus the gateway's own
 * board writes can take several rounds; exhausting them records a conflict.
 */
export async function uploadMergedDocument(opts: {
  store: ObjectStore;
  abs: string;
  key: string;
  relativePath: string;
  previous?: HydrateManifestEntry;
  refresh: RefreshManifest;
  conflict: string;
  backoff?: ConflictBackoff;
}): Promise<MergedUploadResult> {
  const local = await readLocal(opts.abs);
  if (local === undefined)
    return { uploaded: false, vanished: true, attempts: 0 };
  const base = trustedBase(opts.previous);
  const backoff = opts.backoff ?? jitteredConflictBackoff;
  let onDisk = local;
  let conflict = opts.conflict;
  // The remote generation the on-disk bytes are merged against: a later pass
  // may only upload them over exactly that generation.
  let generation = opts.previous?.generation;
  let attempts = 0;
  while (attempts < MERGE_UPLOAD_ATTEMPTS) {
    attempts += 1;
    if (attempts > 1) await sleep(backoff(attempts - 1));
    const temp = atomicTempPath(opts.abs, `${randomUUID()}.remote`);
    const remote = await readRemoteDocument(
      opts.store,
      opts.key,
      temp,
      opts.refresh,
      attempts > 1,
    );
    if (!remote) break;
    const merged =
      remote.body === undefined
        ? local
        : (mergeDocumentBodies(opts.relativePath, local, remote.body, base) ??
          local);
    if (merged !== onDisk) {
      // A standing daemon's agent may rewrite the file while a round waits:
      // leave its bytes for the next pass rather than overwrite them.
      const current = await readLocal(opts.abs);
      if (current === undefined)
        return { uploaded: false, vanished: true, attempts };
      if (current !== onDisk) {
        conflict = `${opts.relativePath} changed locally during its merge`;
        break;
      }
      await writeFile(opts.abs, merged);
      onDisk = merged;
    }
    generation = remote.generation;
    try {
      const result = await opts.store.upload(opts.abs, opts.key, {
        ifGenerationMatch: remote.generation,
      });
      const hash = createHash("sha256").update(merged).digest("hex");
      const removed =
        remote.body === undefined
          ? []
          : removedCardIds(opts.relativePath, remote.body, merged);
      return {
        entry: await withMergeBase(opts.abs, opts.relativePath, {
          hash,
          generation: result?.generation,
        }),
        uploaded: true,
        attempts,
        ...(removed.length > 0 ? { removedCards: removed } : {}),
      };
    } catch (error) {
      if (sourceVanished(error))
        return { uploaded: false, vanished: true, attempts };
      if (!(error instanceof StoreConflictError)) throw error;
      conflict = error.message;
    }
  }
  return {
    entry: opts.previous ? { ...opts.previous, generation } : undefined,
    uploaded: false,
    conflict,
    attempts,
  };
}

/**
 * The agent keeps writing while an upload reads its source, so the file can be
 * unlinked between the scan's hash and the upload's stat/read (runtime session
 * files churn constantly). On the streaming path the errno arrives wrapped as
 * the fetch error's cause.
 */
export function sourceVanished(error: unknown): boolean {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
  const cause = (error as { cause?: unknown }).cause;
  return (cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

async function readLocal(abs: string): Promise<string | undefined> {
  try {
    return await readFile(abs, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
