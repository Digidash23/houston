import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FsVfs, type Vfs } from "@houston/host/src/vfs";
import {
  DEFAULT_EXCLUDES,
  type HydrateManifest,
  type HydrateOptions,
  type ObjectStore,
  startHydrate,
} from "@houston/runtime-client/object-sync";
import { startLazyTurnFilesystem } from "./turn-filesystem-lazy";
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

/** Maximum hydrated bytes accepted by a pooled turn. */
export const TURN_HYDRATE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** Hydrated manifest paired with the resolved on-disk layout. */
export interface TurnFilesystem extends TurnLayout {
  storeRoot: string;
  /** Sync-back ownership: objects on disk (and, lazily, objects owned
   *  without a download). A lazy tree grows this as handlers read. */
  manifest: HydrateManifest;
  /** Reads rooted at `storeRoot`: the real tree when hydrated, the
   *  store-backed overlay when lazy. Readers that may touch an object the
   *  op did not materialize (doc republish) go through this, never `fs`. */
  vfs: Vfs;
  /** Remote objects the lazy listing knows about (diagnostics). */
  listedObjects: number;
  skippedObjects: number;
  /** The store's generation capability as the LISTING showed it. A filtered
   *  or lazy manifest may be empty and cannot answer this on its own. */
  generationAware: boolean;
  /** Tool-call-time CAS writes already durable before the final sync pass. */
  immediateWrites: Set<string>;
}

export interface TurnFilesystemPreparation {
  filesystem: TurnFilesystem;
  hydrated: Promise<TurnFilesystem>;
  /** Attached immediately so a later synchronous setup failure cannot leave
   *  the rejecting hydration promise unobserved. */
  settled: Promise<
    { ok: true; filesystem: TurnFilesystem } | { ok: false; error: unknown }
  >;
  abortHydration: () => void;
}

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
      throw new TurnSetupError(
        "layout_unexpected",
        "turn layout did not resolve from the store listing",
      );
    }
    if (opts.timings) opts.timings.t_startup_files = performance.now();
    const filesystem: TurnFilesystem = {
      ...layout,
      storeRoot,
      manifest: started.manifest,
      vfs: new FsVfs(storeRoot),
      listedObjects: started.listed.rels.length,
      skippedObjects: started.skippedObjects,
      generationAware: started.listed.generationAware,
      immediateWrites: new Set(),
    };
    const hydrated = started.done.then(
      () => filesystem,
      (error: unknown) => {
        throw turnHydrationError(error);
      },
    );
    const settled = hydrated.then(
      (result) => ({ ok: true as const, filesystem: result }),
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
