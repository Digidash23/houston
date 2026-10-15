/**
 * The Share button's pending flag across runs that overlap: a run's upload
 * can settle after a newer run has started (the share stops waiting at its
 * patience, the upload's own answer comes later), and its "done" must not
 * clear the newer run's "Preparing". Each run takes a setter when it starts;
 * only the latest run's setter still reaches the flag. DOM-free.
 */
export function createPendingRuns(
  set: (pending: boolean) => void,
): () => (pending: boolean) => void {
  let latest = 0;
  return () => {
    latest += 1;
    const run = latest;
    return (pending) => {
      if (run === latest) set(pending);
    };
  };
}
