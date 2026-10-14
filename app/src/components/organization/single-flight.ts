/**
 * A gate that runs one task at a time and drops calls while one is running
 * (a double click on Share would open LinkedIn twice). Returns whether the
 * task started. A rejection, or a task that throws before returning its
 * promise, releases the gate; the throw is rethrown to the caller.
 */
export function createSingleFlight() {
  let running = false;
  return (task: () => Promise<unknown>): boolean => {
    if (running) return false;
    running = true;
    const release = () => {
      running = false;
    };
    let pending: Promise<unknown>;
    try {
      pending = task();
    } catch (error) {
      release();
      throw error;
    }
    pending.then(release, release);
    return true;
  };
}
