import { useSyncExternalStore } from "react";

/**
 * Which cards have a completion still being sent, keyed by the card's
 * `completionKey`. Module-level rather than per instance: the user can leave
 * a conversation while the reply uploads, and the card that returns restores
 * its terminal step, which completes again on mount. Its new instance must
 * see the first send still pending, or the same answer and files go out
 * twice.
 */
const pending = new Set<string | symbol>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isCompletionPending(key: string | symbol): boolean {
  return pending.has(key);
}

export function markCompletionPending(key: string | symbol): void {
  pending.add(key);
  notify();
}

export function settleCompletion(key: string | symbol): void {
  if (pending.delete(key)) notify();
}

export function useCompletionPending(key: string | symbol): boolean {
  const read = () => pending.has(key);
  return useSyncExternalStore(subscribe, read, read);
}
