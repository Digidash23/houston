/** The rejection of work whose caller went away before it ran. */
export function abortError(): Error {
  return Object.assign(new Error("lookup abandoned"), { code: "ABORT_ERR" });
}

/** Runs `task` once a slot is free; skipped if `signal` aborts first. */
export type Limit = <T>(
  task: () => Promise<T>,
  signal?: AbortSignal,
) => Promise<T>;

/**
 * Run at most `max` tasks at once, the rest in arrival order. A waiting task
 * whose `signal` aborts leaves the queue and never runs; a finished task
 * hands its slot straight to the next waiter, so no newcomer can overtake.
 */
export function limiter(max: number): Limit {
  let active = 0;
  const waiting: { start: () => void }[] = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next.start();
    else active -= 1;
  };
  return async (task, signal) => {
    if (signal?.aborted) throw abortError();
    if (active < max) active += 1;
    else {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const at = waiting.indexOf(turn);
          if (at !== -1) waiting.splice(at, 1);
          reject(abortError());
        };
        const turn = {
          start: () => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          },
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        waiting.push(turn);
      });
      // The slot was handed over, but the caller may have left before this
      // continuation ran: pass the slot on instead of starting its task.
      if (signal?.aborted) {
        release();
        throw abortError();
      }
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

interface InFlight<T> {
  promise: Promise<T>;
  stop: AbortController;
  waiters: number;
  held: boolean;
}

/**
 * Share one in-flight run per key: callers asking for a key already being
 * looked up join it instead of queueing a second. Each caller may leave with
 * its own `signal`; once every caller has left, the run's signal aborts (a
 * still-queued run is skipped) and the key is forgotten, unless the run
 * called `hold()`: work that cannot be cancelled once begun (getaddrinfo)
 * stays joinable until it settles, so a re-ask never starts a second one.
 * The entry is cleared when the run settles, so answers are never cached.
 */
export function shareInFlight<T>(
  run: (key: string, signal: AbortSignal, hold: () => void) => Promise<T>,
): (key: string, signal?: AbortSignal) => Promise<T> {
  const inFlight = new Map<string, InFlight<T>>();
  const forget = (key: string, entry: InFlight<T>) => {
    if (inFlight.get(key) === entry) inFlight.delete(key);
    entry.stop.abort();
  };
  const start = (key: string): InFlight<T> => {
    // `hold` may run synchronously inside `run`, before `promise` exists.
    const entry: Omit<InFlight<T>, "promise"> = {
      stop: new AbortController(),
      waiters: 0,
      held: false,
    };
    const promise = run(key, entry.stop.signal, () => {
      entry.held = true;
    }).finally(() => {
      entry.held = false;
      forget(key, started);
    });
    const started: InFlight<T> = Object.assign(entry, { promise });
    inFlight.set(key, started);
    return started;
  };
  return (key, signal) => {
    if (signal?.aborted) return Promise.reject(abortError());
    const entry = inFlight.get(key) ?? start(key);
    entry.waiters += 1;
    if (!signal) return entry.promise;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        entry.waiters -= 1;
        if (entry.waiters === 0 && !entry.held) forget(key, entry);
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      // Every waiter subscribes, so a run nobody waits for still has a handler.
      entry.promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  };
}
