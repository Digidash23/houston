import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { normalizeActivities, parseJsonDoc } from "@houston/domain";
import type { Activity } from "@houston/protocol";
import {
  ObjectNotFoundError,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";
import { turnActivityKey } from "./turn-filesystem-scope";

/** Read the board doc fresh from the store; null when it does not exist. */
export type RemoteActivityReader = () => Promise<Activity[] | null>;

/**
 * Read the agent's `activity.json` fresh from the SAME object store (and key)
 * sync-back writes. A new mission's card is created concurrently with its first
 * send, so the tree hydrated at dispatch often predates it; this read is how
 * the after-turn title still finds the card. Downloaded to a temp file OUTSIDE
 * the hydrated tree, so it can never ride sync-back itself.
 */
export function remoteActivityReader(
  store: ObjectStore,
  prefix: string,
  workspaceRel: string,
): RemoteActivityReader {
  return async () => {
    const rel = turnActivityKey(workspaceRel);
    const key = prefix ? posix.join(prefix, rel) : rel;
    const dir = await mkdtemp(join(tmpdir(), "mission-title-"));
    const dest = join(dir, "activity.json");
    try {
      await store.download(key, dest);
      const raw = await readFile(dest, "utf8");
      return normalizeActivities(parseJsonDoc(raw, key), key).items;
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return null;
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
