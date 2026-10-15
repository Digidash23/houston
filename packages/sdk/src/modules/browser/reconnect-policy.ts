/** When the live view's stream reconnects, and when it gives up as `lost`. */

/** Reconnect pauses; past the last attempt the connection is `lost`. */
export const BROWSER_LIVE_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
export const BROWSER_LIVE_MAX_ATTEMPTS = 8;
/**
 * A stream must stay up this long before the reconnect count starts over: the
 * runtime sends a status (and a frame) on every connect, so "it said
 * something" proves nothing about a stream that then dies at once.
 */
export const BROWSER_LIVE_HEALTHY_MS = 10_000;

/** The pause before reconnect `attempt` (1-based). */
export function reconnectDelay(attempt: number): number {
  const steps = BROWSER_LIVE_BACKOFF_MS;
  return steps[Math.min(attempt - 1, steps.length - 1)];
}
