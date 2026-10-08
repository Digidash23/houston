import type { PageLifecycle } from "@houston/sdk";

/** The events that drive the flag, on whatever stands in for `window`. */
export interface PageLifecycleTarget {
  addEventListener(
    type: "beforeunload" | "pagehide" | "pageshow",
    handler: () => void,
  ): void;
}

/** How long a `beforeunload` counts as "leaving" when no `pagehide` follows:
 *  a prompt the person declined, or a download, cancels the navigation and
 *  the page stays. Chromium aborts a reload's requests within a few ms of
 *  `pagehide`; nothing legitimate waits this long between the two. */
export const UNLOAD_CANCELLED_AFTER_MS = 2_000;

/**
 * The SDK's {@link PageLifecycle} port over the real page.
 *
 * `beforeunload` marks the document as leaving as soon as a navigation
 * STARTS: Firefox cancels the document's fetches then, before `pagehide`,
 * which fires at commit (Chromium and WebKit abort them after `pagehide`, so
 * either event is early enough there). `pagehide` marks it too, for the
 * browsers that raise no `beforeunload` for a tab going to the background
 * (iOS). `pageshow` (a back/forward-cache restore of the same document) marks
 * it back, as does a `beforeunload` that no `pagehide` follows within
 * {@link UNLOAD_CANCELLED_AFTER_MS}: the navigation was cancelled and the page
 * lives on. No page at all (SSR, tests): never unloading.
 */
export function createPageLifecycle(
  target: PageLifecycleTarget | null = realWindow(),
  schedule: (fn: () => void, ms: number) => () => void = (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
): PageLifecycle {
  let unloading = false;
  let cancelTimer: (() => void) | null = null;
  const leaving = (settled: boolean) => {
    unloading = true;
    cancelTimer?.();
    cancelTimer = settled
      ? null
      : schedule(() => {
          unloading = false;
          cancelTimer = null;
        }, UNLOAD_CANCELLED_AFTER_MS);
  };
  target?.addEventListener("beforeunload", () => leaving(false));
  target?.addEventListener("pagehide", () => leaving(true));
  target?.addEventListener("pageshow", () => {
    cancelTimer?.();
    cancelTimer = null;
    unloading = false;
  });
  return { isUnloading: () => unloading };
}

/** The page, when there is one. A unit test's bare `window` stub has no
 *  event surface and counts as no page. */
function realWindow(): PageLifecycleTarget | null {
  return typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
    ? window
    : null;
}

let shared: PageLifecycle | null = null;

/**
 * The one lifecycle every SDK instance shares. `createEngineSdk` runs on every
 * bearer rotation and per space, and a fresh set of window listeners each time
 * would never be removed.
 */
export function sharedPageLifecycle(): PageLifecycle {
  shared ??= createPageLifecycle();
  return shared;
}
