/** One key's call in flight, and whether anyone joined it meanwhile. */
export interface Flight<R> {
  promise: Promise<R>;
  dirty: boolean;
}

/**
 * Share one in-flight call per key. A caller asking while `run` is out for
 * `key` joins it, but its ask may stand for a change the running call read
 * too early to see: so a join marks the flight dirty, and a dirty flight runs
 * once more when the current run settles. Everyone gets the final run's
 * answer. Joins during one run coalesce into a single follow-up; the next
 * call after the flight settles starts anew.
 */
export function joinInFlight<R>(
  inFlight: Map<string, Flight<R>>,
  key: string,
  run: () => Promise<R>,
): Promise<R> {
  const joined = inFlight.get(key);
  if (joined) {
    joined.dirty = true;
    return joined.promise;
  }
  const flight: Flight<R> = {
    promise: Promise.resolve() as Promise<R>,
    dirty: false,
  };
  flight.promise = (async () => {
    try {
      for (;;) {
        flight.dirty = false;
        const result = await run();
        if (!flight.dirty) return result;
      }
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, flight);
  return flight.promise;
}
