import type { ShareLanding } from "./org-chart-share-run.ts";

/**
 * The share dialog's state. Pure and DOM-free. Each opening is a new
 * `session`: a share started in one session never writes its line into a
 * later one (closed and reopened while LinkedIn was opening), and a new
 * session or a redrawn image starts with no line and Copy image unflipped.
 */

/** The line under the dialog's buttons, with LinkedIn's link when blocked. */
export type ShareLine = Pick<ShareLanding, "line" | "blocked"> & {
  url: string | null;
};

export interface ShareDialogState {
  open: boolean;
  session: number;
  line: ShareLine | null;
  copied: boolean;
}

export type ShareDialogAction =
  | { type: "open" }
  | { type: "close" }
  /** The picture on screen was replaced (`null` while the new one draws). */
  | { type: "redrawn"; url: string | null }
  | { type: "landed"; session: number; line: ShareLine }
  | { type: "copied" }
  | { type: "copiedDone" };

export const INITIAL_SHARE_DIALOG: ShareDialogState = {
  open: false,
  session: 0,
  line: null,
  copied: false,
};

export function shareDialogReducer(
  state: ShareDialogState,
  action: ShareDialogAction,
): ShareDialogState {
  switch (action.type) {
    case "open":
      return {
        open: true,
        session: state.session + 1,
        line: null,
        copied: false,
      };
    case "close":
      return { ...state, open: false };
    case "redrawn":
      return { ...state, line: null, copied: false };
    case "landed":
      return action.session === state.session
        ? { ...state, line: action.line }
        : state;
    case "copied":
      return { ...state, copied: true };
    case "copiedDone":
      return { ...state, copied: false };
  }
}

/**
 * Whether the picture on screen was replaced. The first image arriving is
 * not: a share started while it drew keeps its line.
 */
export function replacesShownImage(
  previous: string | null,
  next: string | null,
): boolean {
  return previous !== null && previous !== next;
}

/** How long clicks on Open LinkedIn are ignored after one opened it. */
export const LINKEDIN_OPEN_COOLDOWN_MS = 1000;

/**
 * The gate on opening LinkedIn: one share at a time, and none within
 * {@link LINKEDIN_OPEN_COOLDOWN_MS} of the last one starting or settling.
 * Running one at a time is not enough: an open with the page's link settles
 * in a microtask, so a double click (two event turns some 50 ms apart)
 * opened two composers. The first click runs the task synchronously, inside
 * the click. Returns whether the task started; a task that throws before
 * returning its promise releases the gate and the throw is rethrown.
 */
export function createLinkedInGate(
  now: () => number,
  cooldownMs = LINKEDIN_OPEN_COOLDOWN_MS,
) {
  let running = false;
  let last = Number.NEGATIVE_INFINITY;
  return (task: () => Promise<unknown>): boolean => {
    if (running || now() - last < cooldownMs) return false;
    running = true;
    last = now();
    const release = () => {
      running = false;
      last = now();
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
