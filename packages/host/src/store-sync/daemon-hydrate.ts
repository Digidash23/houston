import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  excluded,
  type HydrateManifest,
  hydrate,
} from "@houston/runtime-client/object-sync";
import { logHydrated } from "./daemon-log";
import {
  DEFAULT_MAX_HYDRATE_BYTES,
  type StoreSyncOptions,
} from "./daemon-policy";

/** Left in the local tree by a pod retiring on a lost lease; never synced. */
export const FENCE_RETIRED_MARKER = ".houston-fence-retired";

/** What the retiring boot knew: the store paths its sync had seen. */
export interface RetireMarker {
  retiredAt: string;
  synced: string[];
}

/**
 * Materialize the store into the root; the manifest is the sync's baseline.
 * After a fence retire the container restarts on the same emptyDir, and
 * hydrate only overwrites what the store lists: a local file the store held
 * when the old boot last synced but no longer lists was deleted elsewhere,
 * and the first sync would upload it again under the fresh lease. Those are
 * pruned. A local file the store never held is the old boot's own unsynced
 * write (a session file, the in-flight turn marker) and is kept.
 */
export async function runHydrate(
  opts: StoreSyncOptions,
  excludes: string[],
): Promise<HydrateManifest> {
  const startedAt = Date.now();
  await mkdir(opts.rootDir, { recursive: true });
  const manifest = await hydrate(opts.store, "", opts.rootDir, {
    excludes,
    maxBytes: opts.maxHydrateBytes ?? DEFAULT_MAX_HYDRATE_BYTES,
  });
  logHydrated(opts, manifest.size, startedAt);
  const marker = await readRetireMarker(
    opts,
    join(opts.rootDir, FENCE_RETIRED_MARKER),
  );
  if (marker) {
    let pruned = 0;
    for (const rel of marker.synced) {
      if (manifest.has(rel) || excluded(rel, excludes)) continue;
      // Store keys are plain relative paths; anything else is not ours to rm.
      if (rel.split("/").some((seg) => seg === "" || seg === "..")) continue;
      await rm(join(opts.rootDir, ...rel.split("/")), { force: true });
      pruned += 1;
    }
    await rm(join(opts.rootDir, FENCE_RETIRED_MARKER), { force: true });
    opts.log(
      `[store-sync] pruned ${pruned} local files the store dropped while this pod was fenced`,
    );
  }
  return manifest;
}

/** The marker, or undefined when there is none or it cannot be trusted. */
async function readRetireMarker(
  opts: StoreSyncOptions,
  path: string,
): Promise<RetireMarker | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    opts.log(
      "[store-sync] fence retire marker unreadable; pruning nothing",
      err,
    );
    return undefined;
  }
  const parsed = parseRetireMarker(text);
  if (!parsed) {
    // Pruning on a guess could delete this pod's own writes: keep everything.
    opts.log("[store-sync] fence retire marker unreadable; pruning nothing");
    await rm(path, { force: true });
  }
  return parsed;
}

function parseRetireMarker(text: string): RetireMarker | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { retiredAt, synced } = value as Partial<RetireMarker>;
  if (typeof retiredAt !== "string" || !Array.isArray(synced)) return undefined;
  if (!synced.every((key) => typeof key === "string")) return undefined;
  return { retiredAt, synced };
}
