// The retry ladder behind the assistant address ask. Dependency-light (the
// schedule only) so `app/tests` runs it under node:test without the engine
// import chain; `hooks/use-assistant.ts` binds it to the real call.

import {
  assistantDiscoveryRetryDelayMs,
  shouldRetryAssistantDiscovery,
} from "./assistant-retry-schedule.ts";

export interface DiscoveryLadder<T> {
  /** One silent attempt. */
  ask: () => Promise<T>;
  /** Report the final failure, once, down the path a loud call would use. */
  surface: (err: unknown) => Promise<void>;
  /** The query's cancellation. */
  signal?: AbortSignal;
}

/**
 * Ask until an answer, retrying on the budget each failure earns.
 *
 * A cancelled ask stops where it stands and reports nothing: each attempt
 * reads the ACTIVE space from the live request header, so one made after a
 * space switch would ask the new space and file its answer under the old
 * space's key.
 */
export async function runDiscoveryLadder<T>(
  ladder: DiscoveryLadder<T>,
): Promise<T> {
  const { signal } = ladder;
  for (let failures = 0; ; failures += 1) {
    signal?.throwIfAborted();
    try {
      return await ladder.ask();
    } catch (err) {
      if (signal?.aborted) throw err;
      if (!shouldRetryAssistantDiscovery(failures, err)) {
        await ladder.surface(err);
        throw err;
      }
      await waitUnlessAborted(
        assistantDiscoveryRetryDelayMs(failures, err),
        signal,
      );
    }
  }
}

function waitUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}
