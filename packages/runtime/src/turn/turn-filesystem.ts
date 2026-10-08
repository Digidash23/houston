import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FsVfs } from "@houston/host/src/vfs";
import {
  DEFAULT_EXCLUDES,
  type HydrateOptions,
  type ObjectStore,
  startHydrate,
} from "@houston/runtime-client/object-sync";
import { watchDeferredFiles } from "./turn-deferred-watch";
import { startLazyTurnFilesystem } from "./turn-filesystem-lazy";
import type {
  TurnFilesystem,
  TurnFilesystemPreparation,
} from "./turn-filesystem-types";
import { turnHydrationError } from "./turn-hydration-error";
import {
  resolveListedLayout,
  type TurnLayout,
  TurnSetupError,
} from "./turn-layout";
import { assertMigratedLayout } from "./turn-layout-legacy";
import { turnHydrationPriorityIncludes } from "./turn-runtime";

export {
  claimedTurnIncludes,
  turnActivityKey,
  turnRoutineRunsKey,
  turnSessionScopeIncludes,
} from "./turn-filesystem-scope";
export { syncTurnFilesystem } from "./turn-filesystem-sync";
export type {
  TurnFilesystem,
  TurnFilesystemPreparation,
} from "./turn-filesystem-types";

/** Maximum hydrated bytes accepted by a pooled turn. */
export const TURN_HYDRATE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** Hydrate an isolated store tree and resolve its layout. Claimed turns use
 *  the pool's 2 GiB cap; unclaimed turns keep hydrate's default. */
export async function prepareTurnFilesystem(opts: {
  store: ObjectStore;
  prefix: string;
  root: string;
  claimed: boolean;
  maxBytes?: number;
  /** Extra hydrate excludes (on top of the defaults), e.g. the runtime tree
   *  for an op that never reads conversations. */
  excludes?: string[];
  filter?: HydrateOptions["filter"];
  /**
   * Download nothing up front: list the store, lay out the agent's
   * directory skeleton, and serve reads through a store-backed vfs that
   * materializes one object on first touch. Needs a store with a manifest
   * (a legacy list-only store hydrates eagerly). Only for handlers that
   * read through the vfs port; a turn's tools read the real filesystem.
   */
  lazy?: boolean;
  /** Lazy only: keep just these listed keys (see turn-filesystem-lazy.ts). */
  admit?: (relativePath: string) => boolean;
  /** Only the `migrate` op hydrates a claimed tree its boot migration has
   *  not reached; everything else refuses it (turn-layout-legacy.ts). */
  allowLegacyLayout?: boolean;
}): Promise<TurnFilesystem> {
  return (await startTurnFilesystem(opts)).hydrated;
}

/** Resolve the listed layout, then hydrate runtime inputs before the bulk tree. */
export async function startTurnFilesystem(opts: {
  store: ObjectStore;
  prefix: string;
  root: string;
  claimed: boolean;
  maxBytes?: number;
  excludes?: string[];
  filter?: HydrateOptions["filter"];
  /** Eager trees only: keep these out of `hydrated` (`workspaceReady`). */
  defer?: HydrateOptions["defer"];
  deferredReadTimeoutMs?: number;
  deferredParallel?: number;
  lazy?: boolean;
  admit?: (relativePath: string) => boolean;
  allowLegacyLayout?: boolean;
  timings?: Record<string, number>;
}): Promise<TurnFilesystemPreparation> {
  const storeRoot = join(opts.root, "store");
  await mkdir(storeRoot, { recursive: true });
  const excludes = opts.excludes
    ? [...DEFAULT_EXCLUDES, ...opts.excludes]
    : DEFAULT_EXCLUDES;
  const maxBytes =
    opts.maxBytes ?? (opts.claimed ? TURN_HYDRATE_MAX_BYTES : undefined);
  if (opts.lazy && opts.store.manifest) {
    const listed = await opts.store.manifest(opts.prefix);
    if (opts.timings) opts.timings.t_listing = performance.now();
    const filesystem = await startLazyTurnFilesystem({
      store: opts.store,
      listed,
      prefix: opts.prefix,
      storeRoot,
      claimed: opts.claimed,
      excludes,
      maxBytes: maxBytes ?? TURN_HYDRATE_MAX_BYTES,
      ...(opts.admit ? { admit: opts.admit } : {}),
      ...(opts.allowLegacyLayout ? { allowLegacyLayout: true } : {}),
      ...(opts.timings ? { timings: opts.timings } : {}),
    });
    return {
      filesystem,
      hydrated: Promise.resolve(filesystem),
      settled: Promise.resolve({ ok: true, filesystem }),
      abortHydration: () => undefined,
    };
  }
  let layout: TurnLayout | undefined;
  try {
    const started = await startHydrate(opts.store, opts.prefix, storeRoot, {
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      excludes,
      keepMergeBase: true,
      ...(opts.filter ? { filter: opts.filter } : {}),
      ...(opts.defer ? { defer: opts.defer } : {}),
      ...(opts.deferredReadTimeoutMs !== undefined
        ? { deferredReadTimeoutMs: opts.deferredReadTimeoutMs }
        : {}),
      ...(opts.deferredParallel !== undefined
        ? { deferredParallel: opts.deferredParallel }
        : {}),
      priority: (rel) =>
        turnHydrationPriorityIncludes(
          layout?.dataRel,
          rel,
          opts.filter !== undefined,
        ),
      onListed: async (listing) => {
        if (opts.timings) opts.timings.t_listing = performance.now();
        layout = await resolveListedLayout(storeRoot, listing.rels, {
          allowEmpty: !opts.claimed,
        });
        if (opts.claimed && !opts.allowLegacyLayout)
          assertMigratedLayout(layout, listing.rels);
        if (opts.timings) opts.timings.t_layout = performance.now();
      },
    });
    if (!layout) {
      started.abort();
      await Promise.allSettled([started.deferred]);
      throw new TurnSetupError(
        "layout_unexpected",
        "turn layout did not resolve from the store listing",
      );
    }
    if (opts.timings) opts.timings.t_startup_files = performance.now();
    const watched = opts.defer
      ? watchDeferredFiles(started.deferred, started.abort, opts.timings)
      : undefined;
    const workspaceReady = watched?.workspaceReady;
    const filesystem: TurnFilesystem = {
      ...layout,
      storeRoot,
      manifest: started.manifest,
      vfs: new FsVfs(storeRoot),
      listedObjects: started.listed.rels.length,
      skippedObjects: started.skippedObjects,
      generationAware: started.listed.generationAware,
      immediateWrites: new Set(),
      ...(watched ? watched : {}),
    };
    const hydrated = started.done.then(
      () => filesystem,
      (error: unknown) => {
        throw turnHydrationError(error);
      },
    );
    const settled = Promise.all([hydrated, workspaceReady]).then(
      () => ({ ok: true as const, filesystem }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    return {
      filesystem,
      hydrated,
      settled,
      abortHydration: started.abort,
    };
  } catch (error) {
    throw turnHydrationError(error);
  }
}
