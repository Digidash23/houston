import type { HydrateListedObject } from "./hydrate";

/** Caller policy for one hydration. */
export interface HydrateOptions {
  /** Reject prefixes whose total size exceeds this (default 512 MiB). */
  maxBytes?: number;
  excludes?: string[];
  /**
   * Concurrent downloads (default 16). Hydration gates the managed pod's
   * readiness, and one store round-trip per object (~80 ms through the pod
   * store) dominates cold wake time when it runs sequentially: a routine
   * 133-object workspace measured 10.5 s sequential vs 0.4 s at 16.
   */
  concurrency?: number;
  /** Admit objects after priorities land using the listing and hydrated root. */
  filter?: (
    rel: string,
    listing: readonly HydrateListedObject[],
    hydratedRoot: string,
  ) => boolean;
  /** Every non-excluded path before `filter` (the store's view of the tree) and
   *  whether the listing carried generations (the CAS capability, which a
   *  filtered manifest can no longer answer on its own). */
  onListed?: (listing: {
    rels: string[];
    generationAware: boolean;
  }) => void | Promise<void>;
  /** Download these candidates before filtering the non-priority objects. */
  priority?: (rel: string) => boolean;
  /**
   * Admitted objects kept out of `done`: they start downloading once `done`
   * resolves and land in `deferred`. A caller that defers must observe
   * `deferred`, or its rejection goes unhandled.
   */
  defer?: (rel: string) => boolean;
  /**
   * Deferred objects only: one store read (an object, or a batch) gives up
   * after this long, failing `deferred` instead of hanging whoever waits on
   * it. Absent = no deadline, like the critical set.
   */
  deferredReadTimeoutMs?: number;
  /**
   * Deferred objects only: store reads in flight at once, batched or not
   * (default: the critical set's). They download beside whatever the caller
   * started on `done`, so a lower cap bounds the buffered batch bytes.
   */
  deferredParallel?: number;
  /**
   * Keep the board's hydrated bytes in the manifest as its three-way merge
   * base (`SyncBackOptions.workerMerge`). Off for the standing store sync.
   */
  keepMergeBase?: boolean;
}
