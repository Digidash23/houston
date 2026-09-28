import { readFile, rm } from "node:fs/promises";
import type { ObjectMetadata } from "./object-manifest";
import { ObjectNotFoundError, type ObjectStore } from "./object-store";

/** Lazily fetched remote generations; `fresh` re-lists instead of reusing. */
export type RefreshManifest = (
  fresh?: boolean,
) => Promise<Map<string, ObjectMetadata>> | undefined;

/** The remote document now: absent (`body` undefined, create-only) or read. */
export interface RemoteDocument {
  body?: string;
  generation: string;
}

const CREATE_ONLY: RemoteDocument = { generation: "0" };

/**
 * One read of the remote document with the generation to guard the upload
 * on. A versioned read pairs body and generation atomically; otherwise the
 * listing names it and the upload precondition catches a race in between.
 * Undefined: no generation to guard on, so no safe write.
 */
export async function readRemoteDocument(
  store: ObjectStore,
  key: string,
  temp: string,
  refresh: RefreshManifest,
  fresh: boolean,
): Promise<RemoteDocument | undefined> {
  try {
    let generation: string | undefined;
    if (store.downloadVersioned) {
      generation = (await store.downloadVersioned(key, temp)).generation;
    } else {
      const listing = await refresh(fresh);
      if (!listing) return undefined;
      const current = listing.get(key);
      if (!current) return CREATE_ONLY;
      generation = current.generation;
      await store.download(key, temp);
    }
    if (generation === undefined) return undefined;
    return { body: await readFile(temp, "utf8"), generation };
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return CREATE_ONLY;
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
}
