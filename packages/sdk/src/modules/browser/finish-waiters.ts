/**
 * The live view's pending `finish`: the outcome still to send, and every
 * caller waiting to learn how it settled. A second `finish` before the first
 * settled replaces the outcome; all of them settle together.
 */

import type { BrowserLiveFinishResult } from "./types";

export function finishWaiters() {
  let outcome: "done" | "cancel" | null = null;
  const waiters: ((result: BrowserLiveFinishResult) => void)[] = [];
  return {
    /** The outcome still to send, or null when no finish is pending. */
    pending: (): "done" | "cancel" | null => outcome,
    request(next: "done" | "cancel"): Promise<BrowserLiveFinishResult> {
      outcome = next;
      return new Promise((resolve) => waiters.push(resolve));
    },
    settle(result: BrowserLiveFinishResult): void {
      outcome = null;
      for (const resolve of waiters.splice(0)) resolve(result);
    },
  };
}
