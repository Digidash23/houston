/**
 * Run `show` now if the person is looking at this page, or the moment they
 * come back to it. Share opens LinkedIn in another tab (or the system
 * browser, from the desktop app), so a toast added while they are there
 * would time out unseen. Returns a cancel for unmount. The page is handed
 * in so the timing is testable.
 */

export interface SeenPage {
  visibilityState: DocumentVisibilityState;
  hasFocus: () => boolean;
  addEventListener: (
    type: "visibilitychange" | "focus",
    fn: () => void,
  ) => void;
  removeEventListener: (
    type: "visibilitychange" | "focus",
    fn: () => void,
  ) => void;
}

/** The live page: visibility from `document`, focus from `window`. */
export function livePage(): SeenPage {
  const on = (type: "visibilitychange" | "focus", fn: () => void) =>
    type === "focus"
      ? window.addEventListener(type, fn)
      : document.addEventListener(type, fn);
  const off = (type: "visibilitychange" | "focus", fn: () => void) =>
    type === "focus"
      ? window.removeEventListener(type, fn)
      : document.removeEventListener(type, fn);
  return {
    get visibilityState() {
      return document.visibilityState;
    },
    hasFocus: () => document.hasFocus(),
    addEventListener: on,
    removeEventListener: off,
  };
}

const seen = (page: SeenPage) =>
  page.visibilityState === "visible" && page.hasFocus();

export function whenSeen(page: SeenPage, show: () => void): () => void {
  if (seen(page)) {
    show();
    return () => {};
  }
  const check = () => {
    if (!seen(page)) return;
    stop();
    show();
  };
  const stop = () => {
    page.removeEventListener("visibilitychange", check);
    page.removeEventListener("focus", check);
  };
  page.addEventListener("visibilitychange", check);
  page.addEventListener("focus", check);
  return stop;
}
