import type {
  LeaseHolderState,
  WriteLeaseVerdict,
} from "@houston/runtime-client/object-sync";

/** How often an awake pod re-asks whether it still holds the write lease. */
export const DEFAULT_LEASE_HEARTBEAT_MS = 60_000;

export interface WriteFenceOptions {
  /** The pod-store's lease check; absent where no store fences (tests, PVC). */
  probe?: () => Promise<WriteLeaseVerdict>;
  heartbeatMs?: number;
  /** Runs once, the moment this boot first learns it lost the lease. */
  onLost: (err: { message: string }) => void;
  /**
   * Who holds the lease now: `live` (a running engine; stand down) at most
   * once, then `stale` (nobody; retire) at most once. Never `live` after
   * `stale`.
   */
  onHolder: (holder: LeaseHolderState) => void;
  log: (message: string, err?: unknown) => void;
}

/**
 * This boot's hold on the agent's store write lease, as far as the pod knows.
 *
 * A pod learns of a takeover two ways: its sync meets a 409, or the lease
 * check says so. The sync alone is not enough: it only writes when something
 * changed, so a pod superseded while idle answered the next user write 200,
 * kept it on its own disk and lost it at the next recycle (PRODUCT-1706: a
 * routine edited to 7:00 fired at 7:00 for days, then reverted to 11:30). The
 * check runs before an agent-data write is acknowledged and on a heartbeat.
 *
 * The loss latches: nothing this boot writes can land again. Who holds the
 * lease decides what the owner does next. A live holder is a running engine,
 * and claiming the lease back would make the two trade it through restarts,
 * so the pod stands down and the heartbeat keeps watching; once the holder
 * stops renewing (or never was an engine) the pod retires and its restart
 * claims the lease.
 */
export class WriteFence {
  private lostLatch = false;
  private holder: LeaseHolderState | undefined;
  private unsupportedLogged = false;
  private inFlight: Promise<WriteLeaseVerdict | undefined> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: WriteFenceOptions) {}

  get lost(): boolean {
    return this.lostLatch;
  }

  /**
   * Latch the loss. `holder` comes with a lease-check verdict; a sync 409
   * carries none, so the check is asked (once now, then on the heartbeat).
   */
  lose(err: { message: string }, holder?: LeaseHolderState): void {
    if (this.lostLatch) return;
    this.lostLatch = true;
    this.opts.onLost(err);
    if (holder) this.settle(holder);
    else if (!this.opts.probe) this.settle("stale");
    // The heartbeat timer only calls watch(), which never rejects.
    else void this.watch();
  }

  /**
   * Whether a write acknowledged now can still persist. Concurrent callers
   * share one check. An unreachable store, or one without the check, answers
   * true: the write lands locally like any write during a store outage, and
   * the sync that ships it still carries the lease.
   */
  async writable(): Promise<boolean> {
    if (this.lostLatch) return false;
    const verdict = await this.ask();
    if (verdict?.state === "fenced") {
      this.lose(
        { message: "the store's write lease check answered 409" },
        verdict.holder,
      );
    }
    return !this.lostLatch;
  }

  /** Re-check on a timer, so an idle superseded pod acts on its own. */
  startHeartbeat(): void {
    if (!this.opts.probe || this.heartbeat || this.holder === "stale") return;
    this.heartbeat = setInterval(
      () => void (this.lostLatch ? this.watch() : this.writable()),
      this.opts.heartbeatMs ?? DEFAULT_LEASE_HEARTBEAT_MS,
    );
    this.heartbeat.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  /** After the loss: classify the holder until it is stale. */
  private async watch(): Promise<void> {
    if (this.holder === "stale") return;
    const verdict = await this.ask();
    // A check this boot now passes (it captured a pre-mint its next write
    // would adopt) still finds a boot whose sync has halted: retire it.
    if (verdict?.state === "fenced") this.settle(verdict.holder);
    else if (verdict) this.settle("stale");
  }

  private settle(holder: LeaseHolderState): void {
    if (this.holder === "stale" || this.holder === holder) return;
    this.holder = holder;
    if (holder === "stale") this.stopHeartbeat();
    this.opts.onHolder(holder);
  }

  /** One shared check; undefined when it could not be answered. */
  private ask(): Promise<WriteLeaseVerdict | undefined> {
    const probe = this.opts.probe;
    if (!probe) return Promise.resolve({ state: "held" });
    this.inFlight ??= probe()
      .then((verdict) => {
        if (verdict.state === "unsupported" && !this.unsupportedLogged) {
          this.unsupportedLogged = true;
          this.opts.log(
            "[store-sync] the store has no write lease check; a takeover is caught by the sync's own 409",
          );
        }
        return verdict;
      })
      .catch((err: unknown) => {
        this.opts.log(
          `[store-sync] write lease check failed; accepting the write (${err instanceof Error ? err.message : String(err)})`,
        );
        return undefined;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }
}
