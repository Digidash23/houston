/**
 * When the share toast may show. Share sends the person to LinkedIn (another
 * tab, or the system browser from the desktop app), and a toast added while
 * they are there times out unseen. The desktop shell's open returns before
 * the browser takes focus, so "is the page focused now" is not enough: the
 * click starts a departure watcher, and the toast waits a short grace for
 * the person to leave, then for them to come back. A toast nobody came back
 * for within {@link STALE_MS} is dropped. The page and clock are handed in
 * so the timing is testable.
 */

type PageEvent = "visibilitychange" | "focus" | "blur";

export interface SeenPage {
  visibilityState: DocumentVisibilityState;
  hasFocus: () => boolean;
  addEventListener: (type: PageEvent, fn: () => void) => void;
  removeEventListener: (type: PageEvent, fn: () => void) => void;
}

export interface Clock {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

/** How long a toast waits for the person to leave for LinkedIn. */
export const LEAVE_GRACE_MS = 1500;
/** How long a toast waits for them to come back before it is dropped. */
export const STALE_MS = 5 * 60_000;

/** The live page: visibility from `document`, focus and blur from `window`. */
export function livePage(): SeenPage {
  const target = (type: PageEvent) =>
    type === "visibilitychange" ? document : window;
  return {
    get visibilityState() {
      return document.visibilityState;
    },
    hasFocus: () => document.hasFocus(),
    addEventListener: (type, fn) => target(type).addEventListener(type, fn),
    removeEventListener: (type, fn) =>
      target(type).removeEventListener(type, fn),
  };
}

export const liveClock: Clock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

const seen = (page: SeenPage) =>
  page.visibilityState === "visible" && page.hasFocus();

/** Listen to `types` until the returned stop is called. */
function listen(page: SeenPage, types: PageEvent[], fn: () => void) {
  for (const type of types) page.addEventListener(type, fn);
  return () => {
    for (const type of types) page.removeEventListener(type, fn);
  };
}

export interface Departure {
  /** The person left the page (blur or hidden) since the click. */
  readonly left: boolean;
  stop: () => void;
}

/** Started in the click's own tick, before anything opens. */
export function watchDeparture(page: SeenPage): Departure {
  const state = { left: false };
  const stop = listen(page, ["blur", "visibilitychange"], () => {
    if (!seen(page)) state.left = true;
  });
  return {
    get left() {
      return state.left;
    },
    stop,
  };
}

/**
 * Run `show` once the person is looking at the page. `expectLeave`: a tab
 * or browser was just opened, so first give them {@link LEAVE_GRACE_MS} to
 * go, and if they do, wait for them to come back. Returns a cancel.
 */
export function showWhenBack(
  page: SeenPage,
  show: () => void,
  options: { departure?: Departure; expectLeave: boolean; clock: Clock },
): () => void {
  const { clock } = options;
  // The departure watcher stops with everything else, the stale drop included.
  const stops: (() => void)[] = options.departure
    ? [options.departure.stop]
    : [];
  const cancel = () => {
    for (const stop of stops.splice(0)) stop();
  };
  const timer = (fn: () => void, ms: number) => {
    const id = clock.setTimeout(fn, ms);
    stops.push(() => clock.clearTimeout(id));
  };
  const showNow = () => {
    cancel();
    show();
  };
  let waiting = false;
  const waitForReturn = () => {
    if (waiting) return;
    waiting = true;
    stops.push(
      listen(page, ["visibilitychange", "focus"], () => {
        if (seen(page)) showNow();
      }),
    );
  };
  timer(cancel, STALE_MS);
  const gone = !seen(page) || options.departure?.left === true;
  if (gone) {
    if (seen(page)) showNow();
    else waitForReturn();
  } else if (!options.expectLeave) showNow();
  else {
    // Still here: give the browser a moment to take focus.
    const stopLeave = listen(page, ["blur", "visibilitychange"], () => {
      if (seen(page)) return;
      stopLeave();
      waitForReturn();
    });
    stops.push(stopLeave);
    timer(() => {
      stopLeave();
      if (waiting) return;
      if (seen(page)) showNow();
      else waitForReturn();
    }, LEAVE_GRACE_MS);
  }
  return cancel;
}
