import type { LeaseHolderState } from "@houston/runtime-client/object-sync";

/** How long a retiring pod's runtimes get to stop before they are killed. */
export const FENCE_RETIRE_DRAIN_MS = 3_000;
/** Ceiling on the whole retire: past it the process exits regardless. */
export const FENCE_RETIRE_DEADLINE_MS = 20_000;

export interface FenceRetireDeps {
  /** The host's own stop, with a drain budget short enough for a retire. */
  stop: (opts: { drainMs: number }) => Promise<void>;
  /** Stop the local routine schedule, nothing else. */
  standDown: () => void;
  exit: (code: number) => void;
  /** Deliver queued error reports before the process goes. */
  flushReports: () => Promise<unknown>;
  deadlineMs?: number;
}

/**
 * A managed pod that lost its store write lease to another boot can never
 * persist anything again, so it must stop being the agent's engine. Serving
 * on was the PRODUCT-1706 failure: nothing routed the agent away from the
 * pod, its local cron kept firing its local copy of the routines, and every
 * write it took was gone at the next recycle. Writes are already refused
 * (routes/store-fence-gate.ts); this decides the rest by who holds the lease.
 *
 * `live`: another running engine owns the agent (a split brain, or a
 * replacement while this pod drains). Claiming the lease back would make the
 * two trade it through restarts, so the pod only stops its local schedule
 * and waits: it is the one being replaced.
 *
 * `stale`: nobody is writing (a control-plane mint no engine adopted, or a
 * boot that stopped renewing). The pod exits non-zero. A pod already
 * terminating just ends sooner; a live replica is restarted in place by the
 * kubelet, waits out any predecessor drain, claims a fresh lease and hydrates
 * what the store holds, so the agent converges on exactly one writer. The
 * drain is short on purpose: a turn finishing here would show the user a
 * reply this pod cannot keep.
 */
export function respondToFenceLoss(
  deps: FenceRetireDeps,
): (holder: LeaseHolderState) => void {
  let stoodDown = false;
  let retiring = false;
  return (holder) => {
    if (holder === "live") {
      if (stoodDown || retiring) return;
      stoodDown = true;
      console.error(
        "[local-host] another running engine owns this agent's store; this pod stops firing routines and refuses writes until it is replaced",
      );
      deps.standDown();
      return;
    }
    if (retiring) return;
    retiring = true;
    console.error(
      "[local-host] another boot owns this agent's store and this pod can no longer persist writes; retiring it so the agent has one writer",
    );
    const deadline = new Promise<void>((resolve) => {
      setTimeout(resolve, deps.deadlineMs ?? FENCE_RETIRE_DEADLINE_MS);
    });
    const stopped = deps
      .stop({ drainMs: FENCE_RETIRE_DRAIN_MS })
      .catch((err: unknown) => {
        console.error("[local-host] retire stop failed; exiting anyway:", err);
      });
    void Promise.race([stopped, deadline])
      .then(() => deps.flushReports())
      .finally(() => deps.exit(1));
  };
}
