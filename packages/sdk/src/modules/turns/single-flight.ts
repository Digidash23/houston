/**
 * Share one in-flight call per key: a caller asking while `run` is out for
 * `key` joins it and gets its answer; the next call after it settles runs
 * anew.
 */
export function joinInFlight<R>(
  inFlight: Map<string, Promise<R>>,
  key: string,
  run: () => Promise<R>,
): Promise<R> {
  const joined = inFlight.get(key);
  if (joined) return joined;
  const call = run().finally(() => inFlight.delete(key));
  inFlight.set(key, call);
  return call;
}
