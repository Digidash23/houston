/**
 * Writes that must land in the order the user made them, one key at a time
 * (one agent's file). Optimistic surfaces no longer wait for a write to land
 * before offering the next, so two sent together could reach the host out of
 * order (or each read-modify-write the same file and drop the other's change).
 *
 * The stored tail is the SETTLED one: a rejection reaches its own caller and
 * the next write still runs. Different keys never wait on each other.
 */
export function serialQueue() {
  const tails = new Map<string, Promise<void>>();
  return function queued<T>(key: string, write: () => Promise<T>): Promise<T> {
    const result = (tails.get(key) ?? Promise.resolve()).then(write);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    // Forget an idle key so the map never grows with every agent ever written.
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}
