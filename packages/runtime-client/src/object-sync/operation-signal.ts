/**
 * Run one object-store operation on its own AbortSignal that follows
 * `parent`. fetch hangs an abort listener on the signal it is given and drops
 * it only when the Request is garbage-collected, so thousands of reads sharing
 * one long-lived signal (a boot hydrate's) pile listeners on it until GC runs
 * and flood `MaxListenersExceededWarning`. The operation's own signal takes
 * those; the single listener on `parent` goes when the operation settles,
 * after its body is read, so an abort still cancels it midway.
 */
export async function withOperationSignal<T>(
  parent: AbortSignal | undefined,
  run: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  if (!parent || parent.aborted) return run(parent);
  const own = new AbortController();
  const follow = () => own.abort(parent.reason);
  parent.addEventListener("abort", follow, { once: true });
  try {
    return await run(own.signal);
  } finally {
    parent.removeEventListener("abort", follow);
  }
}
