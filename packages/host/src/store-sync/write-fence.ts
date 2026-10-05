import type { WriteLeaseVerdict } from "@houston/runtime-client/object-sync";

/** How often an awake pod re-asks whether it still holds the write lease. */
export const DEFAULT_LEASE_HEARTBEAT_MS = 60_000;

export interface WriteFenceOptions {
  /** The pod-store's lease check; absent where no store fences (tests, PVC). */
  probe?: () => Promise<WriteLeaseVerdict>;
  heartbeatMs?: number;
  /** Runs once, the moment this boot first learns it lost the lease. */
  onLost: (err: { message: string }) => void;
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
 * The loss latches: nothing this boot writes can land again, so the owner
 * retires the pod rather than keep serving.
 */
export class WriteFence {
  private lostLatch = false;
  private probeUnsupported = false;
  private inFlight: Promise<boolean> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: WriteFenceOptions) {}

  get lost(): boolean {
    return this.lostLatch;
  }

  /** Latch the loss and tell the owner, once. */
  lose(err: { message: string }): void {
    if (this.lostLatch) return;
    this.lostLatch = true;
    this.stopHeartbeat();
    this.opts.onLost(err);
  }

  /**
   * Whether a write acknowledged now can still persist. Concurrent callers
   * share one check. An unreachable store answers true: the write lands
   * locally like any write during a store outage, and the sync that ships it
   * still carries the lease, so a takeover is caught there.
   */
  writable(): Promise<boolean> {
    if (this.lostLatch) return Promise.resolve(false);
    const probe = this.opts.probe;
    if (!probe || this.probeUnsupported) return Promise.resolve(true);
    this.inFlight ??= this.ask(probe).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /** Re-check on a timer, so an idle superseded pod retires on its own. */
  startHeartbeat(): void {
    if (!this.opts.probe || this.heartbeat || this.lostLatch) return;
    this.heartbeat = setInterval(
      // writable() never rejects: a failed check resolves true.
      () => void this.writable(),
      this.opts.heartbeatMs ?? DEFAULT_LEASE_HEARTBEAT_MS,
    );
    this.heartbeat.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private async ask(probe: () => Promise<WriteLeaseVerdict>): Promise<boolean> {
    let verdict: WriteLeaseVerdict;
    try {
      verdict = await probe();
    } catch (err) {
      this.opts.log(
        `[store-sync] write lease check failed; accepting the write (${err instanceof Error ? err.message : String(err)})`,
      );
      return true;
    }
    if (verdict === "fenced") {
      this.lose({ message: "the store's write lease check answered 409" });
      return false;
    }
    if (verdict === "unsupported") {
      this.probeUnsupported = true;
      this.stopHeartbeat();
      this.opts.log(
        "[store-sync] the store has no write lease check; a takeover is caught by the sync's own 409",
      );
    }
    return !this.lostLatch;
  }
}
