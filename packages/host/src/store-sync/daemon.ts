import {
  type HydrateManifest,
  StoreFencedError,
} from "@houston/runtime-client/object-sync";
import type { TreeWatch } from "../watch/watch-tree";
import { CoalescedRun } from "./coalesced-run";
import { createDaemonFence } from "./daemon-fence";
import { FENCE_RETIRED_MARKER, runHydrate } from "./daemon-hydrate";
import { logFenceLost, logSyncFailed, logSyncResult } from "./daemon-log";
import {
  awaitInFlightSync,
  DEFAULT_INTERVAL_MS,
  DEFAULT_QUIET_MS,
  runFinalSync,
  runSyncBack,
  STORE_SYNC_EXCLUDES,
  type StoreSyncOptions,
  startTreeWatch,
} from "./daemon-policy";
import type { WriteFence } from "./write-fence";

export { STORE_SYNC_EXCLUDES, type StoreSyncOptions } from "./daemon-policy";

export class StoreSyncDaemon {
  private manifest: HydrateManifest = new Map();
  private hydrated = false;
  private started = false;
  private stopping = false;
  private dirty = false;
  private dirtyVersion = 0;
  private watcher: TreeWatch | undefined;
  private quietTimer: ReturnType<typeof setTimeout> | undefined;
  private intervalTimer: ReturnType<typeof setInterval> | undefined;
  private readonly fence: WriteFence;
  private readonly syncs = new CoalescedRun(
    () => this.syncOnce(),
    () => !this.stopping && !this.fence.lost,
  );
  private consecutiveFailures = 0;

  constructor(private readonly opts: StoreSyncOptions) {
    this.fence = createDaemonFence(opts, (err) => this.haltFenced(err));
  }

  get fenced(): boolean {
    return this.fence.lost;
  }

  /** Whether a write acknowledged now can still persist (write-fence.ts). */
  writable(): Promise<boolean> {
    return this.fence.writable();
  }

  /** The synced tree's root. Owned here so the drain handshake (which writes
   *  and reads ONE object outside the daemon's passes) never recomputes it. */
  get rootDir(): string {
    return this.opts.rootDir;
  }

  /** Returns the number of objects restored (the boot telemetry records it). */
  async hydrate(): Promise<number> {
    this.hydrated = false;
    this.fence.startHeartbeat();
    this.manifest = await runHydrate(this.opts, this.excludes);
    this.hydrated = true;
    return this.manifest.size;
  }

  start(): void {
    if (!this.hydrated) {
      throw new Error("store sync cannot start before successful hydration");
    }
    if (this.started || this.fence.lost) return;
    this.started = true;
    this.fence.startHeartbeat();
    this.watcher = startTreeWatch(this.opts, () => this.markDirty());
    this.intervalTimer = setInterval(
      () => this.runInBackground("periodic"),
      this.opts.intervalMs ?? DEFAULT_INTERVAL_MS,
    );
    this.intervalTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.fence.stopHeartbeat();
    this.stopScheduling();
    if (!this.hydrated) return;

    const inFlight = this.syncs.inFlight;
    if (inFlight) await awaitInFlightSync(this.opts, inFlight);
    if (this.fence.lost) {
      this.started = false;
      return;
    }
    await runFinalSync(this.opts, () => this.syncOnce());
    this.started = false;
  }

  private get excludes(): string[] {
    return [
      ...(this.opts.excludes ?? STORE_SYNC_EXCLUDES),
      FENCE_RETIRED_MARKER,
    ];
  }

  private markDirty(): void {
    if (this.stopping || this.fence.lost) return;
    this.dirty = true;
    this.dirtyVersion += 1;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(
      () => this.runInBackground("debounced"),
      this.opts.quietMs ?? DEFAULT_QUIET_MS,
    );
    this.quietTimer.unref?.();
  }

  /**
   * Sync the tree NOW and resolve once it landed. For writes another party
   * reads back from object storage right away — the gateway's bridge binding
   * check reads the runtime's `custom-endpoint.json` the moment the desktop
   * probes a freshly connected local model, while the watcher skips the
   * workspaces subtree (HOU-1237) and the periodic pass is 5 minutes out
   * (PRODUCT-1807). A no-op before start, after stop, or once fenced.
   */
  async flush(): Promise<void> {
    if (this.markForSync()) await this.syncs.request();
  }

  /**
   * Ship an acknowledged write now, under the lease the gate just checked:
   * the watcher skips the workspaces subtree, and a write left for the
   * 5-minute pass is lost if a takeover lands first. Only while this boot
   * carries a lease token, so an unfenced deployment syncs exactly as before.
   */
  syncAfterWrite(): void {
    if ((this.opts.leaseClaimed?.() ?? true) && this.markForSync()) {
      this.runInBackground("write");
    }
  }

  private markForSync(): boolean {
    if (!this.started || this.stopping || this.fence.lost) return false;
    this.dirty = true;
    this.dirtyVersion += 1;
    return true;
  }

  private runInBackground(trigger: string): void {
    if (
      this.stopping ||
      this.fence.lost ||
      (trigger === "debounced" && !this.dirty)
    )
      return;
    void this.syncs.request().catch((err) => {
      logSyncFailed(this.opts, trigger, this.consecutiveFailures, err);
    });
  }

  private async syncOnce(): Promise<void> {
    const version = this.dirtyVersion;
    let result: Awaited<ReturnType<typeof runSyncBack>>;
    try {
      result = await runSyncBack(this.opts, this.manifest, this.excludes);
    } catch (err) {
      if (!(err instanceof StoreFencedError)) {
        this.consecutiveFailures += 1;
        throw err;
      }
      this.fence.lose(err);
      return;
    }
    this.consecutiveFailures = 0;
    this.manifest = result.manifest;
    if (version === this.dirtyVersion) this.dirty = false;
    logSyncResult(result, this.opts);
  }

  /** The sync halts for good; the fence's heartbeat keeps watching the holder. */
  private haltFenced(err: { message: string }): void {
    this.dirty = false;
    this.syncs.cancelRerun();
    this.stopScheduling();
    logFenceLost(this.opts, err);
  }

  private stopScheduling(): void {
    this.watcher?.close();
    this.watcher = undefined;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.quietTimer = undefined;
    this.intervalTimer = undefined;
  }
}
