/**
 * The bound on roster-wide reads. The cross-agent missions sweep reads every
 * agent's board on each app load; unbounded, a 105-agent space put 105
 * requests on the gateway in the same instant, each resolving the caller's
 * memberships, and a reload cancelled all of them together.
 *
 * Through the gate at most {@link AGENT_FAN_OUT_LIMIT} reads start per slot
 * turnover. A read the gateway holds open (an asleep agent waiting on its
 * engine can be held for most of a minute) gives its slot up after
 * {@link FAN_OUT_SLOT_LEASE_MS} and keeps running, so a few held reads never
 * serialize the rest of the roster behind them.
 *
 * Reads for the one agent the person is looking at never go through here.
 */

import type { Clock } from "./ports";

/** Roster-wide reads started at once, per gate. */
export const AGENT_FAN_OUT_LIMIT = 8;

/** How long a read holds its slot before the next queued read may start. */
export const FAN_OUT_SLOT_LEASE_MS = 2_000;

export interface FanOutSettleOptions {
  /** Aborting drops every read still queued (it rejects with the signal's
   *  reason, unrun). Reads already started run to completion. */
  signal?: AbortSignal;
}

export interface FanOutGate {
  /** Run one read once a slot is free. Resolves or rejects as the read does. */
  run<T>(read: () => Promise<T>, opts?: FanOutSettleOptions): Promise<T>;
  /**
   * Read every item through the gate. Never rejects: each outcome is settled
   * in input order, like `Promise.allSettled`.
   */
  settle<I, T>(
    items: readonly I[],
    read: (item: I) => Promise<T>,
    opts?: FanOutSettleOptions,
  ): Promise<PromiseSettledResult<T>[]>;
}

export function createFanOutGate({
  limit = AGENT_FAN_OUT_LIMIT,
  leaseMs = FAN_OUT_SLOT_LEASE_MS,
  timers = globalTimers,
}: {
  limit?: number;
  leaseMs?: number;
  timers?: Pick<Clock, "setTimeout" | "clearTimeout">;
} = {}): FanOutGate {
  if (!(limit >= 1)) throw new RangeError(`fan-out limit must be >= 1`);
  let active = 0;
  const waiting: Array<() => void> = [];

  // A freed slot passes straight to the next waiter, so `active` only drops
  // when nobody is queued.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  const acquire = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (active < limit) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const at = waiting.indexOf(grant);
        if (at >= 0) waiting.splice(at, 1);
        reject(signal?.reason);
      };
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      waiting.push(grant);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  const run = async <T>(
    read: () => Promise<T>,
    opts?: FanOutSettleOptions,
  ): Promise<T> => {
    await acquire(opts?.signal);
    let held = true;
    const free = () => {
      if (!held) return;
      held = false;
      release();
    };
    const lease = timers.setTimeout(free, leaseMs);
    try {
      return await read();
    } finally {
      timers.clearTimeout(lease);
      free();
    }
  };

  return {
    run,
    settle: (items, read, opts) =>
      Promise.allSettled(items.map((item) => run(() => read(item), opts))),
  };
}

// Read at call time, so a test's fake timers apply to a gate built before
// they were installed.
const globalTimers: Pick<Clock, "setTimeout" | "clearTimeout"> = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
};
