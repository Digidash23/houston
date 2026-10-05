import { access, mkdir, readdir, rm } from "node:fs/promises";
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

/**
 * Materialize the store into the root; the manifest is the sync's baseline.
 * After a fence retire the container restarts on the same emptyDir, and
 * hydrate only overwrites what the store lists: every other local file would
 * be uploaded as new under the fresh lease. Those are pruned first.
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
  const marker = join(opts.rootDir, FENCE_RETIRED_MARKER);
  if (await exists(marker)) {
    let pruned = 0;
    for (const rel of await localFiles(opts.rootDir)) {
      if (manifest.has(rel) || excluded(rel, excludes)) continue;
      await rm(join(opts.rootDir, ...rel.split("/")), { force: true });
      pruned += 1;
    }
    await rm(marker, { force: true });
    opts.log(
      `[store-sync] pruned ${pruned} local files the store does not hold after a fence retire`,
    );
  }
  return manifest;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Every regular file under root, as a forward-slash relative path. */
async function localFiles(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await localFiles(root, child)));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}
