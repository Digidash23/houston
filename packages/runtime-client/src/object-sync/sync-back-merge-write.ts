import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { atomicTempPath } from "@houston/protocol";
import { mergeDocumentBodies } from "./sync-back-doc-merge";
import type { RemoteDocument } from "./sync-back-remote-read";

/** One merge round's bytes, and why they are the local ones unmerged. */
export interface MergeOutcome {
  body: string;
  unmergeable?: string;
}

/**
 * Merge the turn's bytes into the remote document. A side that will not parse
 * as the document (a byte-order mark, trailing bytes, a board that is not an
 * array) cannot be merged: the local bytes overwrite the remote, as every
 * conflict did before merges existed, and the reason rides the sync result to
 * the terminal frame instead of throwing out of the whole pass.
 */
export function mergeOrOverwrite(
  relativePath: string,
  local: string,
  remote: RemoteDocument,
  base: string | undefined,
): MergeOutcome {
  if (remote.body === undefined) return { body: local };
  try {
    return {
      body:
        mergeDocumentBodies(relativePath, local, remote.body, base) ?? local,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[sync-back] ${relativePath} unmergeable, local bytes overwrite the remote: ${reason}`,
    );
    return { body: local, unmergeable: reason };
  }
}

/**
 * Replace `abs` whole: a reader (the host's own doc cache, a watcher) never
 * sees a half-written merge. The temp name carries `ATOMIC_TMP_SUFFIX`, which
 * the store sync never uploads.
 */
export async function writeAtomically(abs: string, body: string) {
  const temp = atomicTempPath(abs, randomUUID());
  try {
    await writeFile(temp, body);
    await rename(temp, abs);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
