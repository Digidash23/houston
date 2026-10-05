/** How long a retiring pod's runtimes get to stop before they are killed. */
export const FENCE_RETIRE_DRAIN_MS = 3_000;
/** Ceiling on the whole retire: past it the process exits regardless. */
export const FENCE_RETIRE_DEADLINE_MS = 20_000;

export interface FenceRetireDeps {
  /** The host's own stop, with a drain budget short enough for a retire. */
  stop: (opts: { drainMs: number }) => Promise<void>;
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
 * write it took was gone at the next recycle.
 *
 * Exiting non-zero ends that. A pod already terminating (an eviction whose
 * replacement holds the lease) just ends sooner. A pod that is still the
 * Deployment's replica is restarted by the kubelet in place: the new process
 * waits out any predecessor drain, claims a fresh lease and hydrates what the
 * store holds, so the agent converges on exactly one writer. The drain is
 * short on purpose: a turn finishing here would show the user a reply this
 * pod cannot keep.
 */
export function retireOnFenceLoss(deps: FenceRetireDeps): () => void {
  let retiring = false;
  return () => {
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
