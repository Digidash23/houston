import { mkdir } from "node:fs/promises";
import {
  type HydrateManifest,
  hydrate,
} from "@houston/runtime-client/object-sync";
import { logHydrated } from "./daemon-log";
import {
  DEFAULT_MAX_HYDRATE_BYTES,
  type StoreSyncOptions,
} from "./daemon-policy";

/** Materialize the store into the root; the manifest is the sync's baseline. */
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
  return manifest;
}
