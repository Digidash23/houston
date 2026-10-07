import type { Vfs } from "@houston/host/src/vfs";
import type { HydrateManifest } from "@houston/runtime-client/object-sync";
import type { TurnLayout } from "./turn-layout";

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
  /** Objects hydration deferred past `hydrated` (turn-deferred-files.ts).
   *  Absent when nothing was deferred. Every tool, the turn's file-change
   *  snapshot and the final sync wait for it. */
  workspaceReady?: Promise<void>;
  /** The prompt is over: stop the deferred download if it has not landed,
   *  and sync as after a failed one (turn-deferred-watch.ts). */
  abandonDeferred?: () => void;
}

export interface TurnFilesystemPreparation {
  filesystem: TurnFilesystem;
  hydrated: Promise<TurnFilesystem>;
  /** Attached immediately so a later synchronous setup failure cannot leave
   *  the rejecting hydration promise unobserved. Covers deferred objects. */
  settled: Promise<
    { ok: true; filesystem: TurnFilesystem } | { ok: false; error: unknown }
  >;
  abortHydration: () => void;
}
