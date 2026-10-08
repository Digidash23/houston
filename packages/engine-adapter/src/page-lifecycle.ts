import type { PageLifecycle } from "@houston/sdk";

/** The two events that flip the flag, on whatever stands in for `window`. */
export interface PageLifecycleTarget {
  addEventListener(type: "pagehide" | "pageshow", handler: () => void): void;
}

/**
 * The SDK's {@link PageLifecycle} port over the real page: `pagehide` marks
 * the document as leaving, `pageshow` (a back/forward-cache restore of the
 * same document) marks it back. `pagehide` fires before the browser aborts the
 * document's in-flight requests, so by the time a fetch rejects for that
 * reason the flag already reads true. No page at all (SSR, tests): never
 * unloading.
 */
export function createPageLifecycle(
  target: PageLifecycleTarget | null = typeof window === "undefined"
    ? null
    : window,
): PageLifecycle {
  let unloading = false;
  target?.addEventListener("pagehide", () => {
    unloading = true;
  });
  target?.addEventListener("pageshow", () => {
    unloading = false;
  });
  return { isUnloading: () => unloading };
}
