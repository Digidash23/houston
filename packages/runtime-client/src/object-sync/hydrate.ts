import {
  downloadHydrationEntries,
  type HydrateDownloadState,
  type HydrateEntry,
} from "./hydrate-download";
import { DEFAULT_EXCLUDES, excluded } from "./hydrate-excludes";
import { assertListedWithinCap, HydrateLimitError } from "./hydrate-limit";
import type { ObjectStore } from "./object-store";

export { DEFAULT_EXCLUDES, excluded } from "./hydrate-excludes";
export { HydrateLimitError } from "./hydrate-limit";

/**
 * Durable engine state is materialized into a local cache, then synchronized
 * back by content hash. The hydration manifest is the ownership boundary: only
 * objects observed on hydrate may be interpreted as locally deleted later.
 * Authentication material and temporary files never cross this boundary.
 */

export interface HydrateManifestEntry {
  hash: string;
  generation?: string;
  /** Observed bytes of a three-way-merged doc; trusted only if sha256 = hash. */
  mergeBase?: string;
}

/** Relative path to the hydrated bytes and their optional remote generation. */
export type HydrateManifest = Map<string, HydrateManifestEntry>;

import type { HydrateOptions } from "./hydrate-options";

export type { HydrateOptions };

/** Store-listing fields available to a caller's hot-set selector. */
export interface HydrateListedObject {
  rel: string;
  updated?: string;
}

const DEFAULT_HYDRATE_CONCURRENCY = 16;

export interface StartedHydration {
  manifest: HydrateManifest;
  listed: { rels: string[]; generationAware: boolean };
  /** Listed objects rejected by the caller's filter. */
  skippedObjects: number;
  /** Resolves only after every non-priority, non-deferred object has landed. */
  done: Promise<void>;
  /** Resolves after `done` and every `opts.defer` object has landed. */
  deferred: Promise<void>;
  /** Stop admitting downloads and cancel adapters that support AbortSignal. */
  abort: () => void;
}

/** List once, hydrate priority inputs, then start the remaining downloads. */
export async function startHydrate(
  store: ObjectStore,
  prefix: string,
  destDir: string,
  opts: HydrateOptions = {},
): Promise<StartedHydration> {
  const excludes = opts.excludes ?? DEFAULT_EXCLUDES;
  const maxBytes = opts.maxBytes ?? 512 * 1024 * 1024;
  // Guard against a non-finite override (NaN sizes the worker array to ZERO,
  // which would return a successful empty manifest for a non-empty store —
  // the exact partial-manifest state the hydration latch exists to prevent).
  const requested = opts.concurrency ?? DEFAULT_HYDRATE_CONCURRENCY;
  const concurrency =
    Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : DEFAULT_HYDRATE_CONCURRENCY;
  const manifest: HydrateManifest = new Map();
  const objects = store.manifest ? await store.manifest(prefix) : undefined;
  const storeObjects =
    objects ??
    (await store.list(prefix)).map((key) => ({ key, generation: undefined }));
  const candidates: (HydrateEntry & { updated?: string })[] = [];
  const sizes = new Map<string, number>();
  let generationAware = false;
  for (const object of storeObjects) {
    const { key } = object;
    const rel = prefix ? key.slice(prefix.length + 1) : key;
    if (!rel || excluded(rel, excludes)) continue;
    if (object.generation !== undefined) generationAware = true;
    if ("size" in object) sizes.set(rel, object.size);
    candidates.push({
      key,
      rel,
      generation: object.generation,
      ...("updated" in object && object.updated
        ? { updated: object.updated }
        : {}),
    });
  }
  const filterListing = candidates.map(({ rel, updated }) => ({
    rel,
    ...(updated ? { updated } : {}),
  }));
  const listed = {
    rels: candidates.map(({ rel }) => rel),
    generationAware,
  };
  await opts.onListed?.(listed);
  const priorityCandidates = opts.priority
    ? candidates.filter((entry) => opts.priority?.(entry.rel))
    : [];
  const priorityRels = new Set(priorityCandidates.map(({ rel }) => rel));
  const controller = new AbortController();
  const state: HydrateDownloadState = {
    total: 0,
    failed: false,
    fail(error) {
      if (this.failed) return;
      this.failed = true;
      this.firstError = error;
      controller.abort(error);
    },
  };
  const download = (batch: HydrateEntry[]) =>
    downloadHydrationEntries({
      store,
      destDir,
      entries: batch,
      manifest,
      maxBytes,
      concurrency,
      state,
      keepMergeBase: opts.keepMergeBase === true,
      signal: controller.signal,
      limitError: (observedBytes) =>
        new HydrateLimitError(maxBytes, observedBytes),
    });
  const filter = opts.filter;
  const priority = filter
    ? priorityCandidates.filter((entry) =>
        filter(entry.rel, filterListing, destDir),
      )
    : priorityCandidates;
  await download(priority);
  const remainingCandidates = candidates.filter(
    ({ rel }) => !priorityRels.has(rel),
  );
  const remaining = filter
    ? remainingCandidates.filter((entry) =>
        filter(entry.rel, filterListing, destDir),
      )
    : remainingCandidates;
  const defer = opts.defer;
  const later = defer ? remaining.filter(({ rel }) => defer(rel)) : [];
  if (later.length)
    assertListedWithinCap([...priority, ...remaining], sizes, maxBytes);
  const done = download(
    later.length ? remaining.filter(({ rel }) => !defer?.(rel)) : remaining,
  );
  return {
    manifest,
    listed,
    skippedObjects: candidates.length - priority.length - remaining.length,
    done,
    // After `done`, so a deferred object never takes bandwidth from the set
    // the caller is blocked on.
    deferred: later.length ? done.then(() => download(later)) : done,
    abort: () => state.fail(new Error("hydration aborted before cleanup")),
  };
}

/** Download everything under `prefix` into `destDir`. Returns the manifest. */
export async function hydrate(
  store: ObjectStore,
  prefix: string,
  destDir: string,
  opts: HydrateOptions = {},
): Promise<HydrateManifest> {
  const started = await startHydrate(store, prefix, destDir, opts);
  await started.deferred;
  return started.manifest;
}

export type {
  LocalWriteLock,
  SyncBackOptions,
  SyncMerge,
  SyncResult,
} from "./sync-back";
export { syncBack } from "./sync-back";
