import type { LinkedInConnectWatch } from "@houston/sdk/linkedin/policy";
import type { ShareLine } from "./org-chart-share-run.ts";

/**
 * The share dialog's state. Pure and DOM-free. Each opening is a new
 * `session`: a share started in one session never writes into a later one
 * (closed and reopened while LinkedIn was opening), and a new session starts
 * with no line, the post's own words, no connect under way and Copy image
 * unflipped. A redrawn image drops the line and the flip: what was said about
 * the old picture no longer holds.
 */

export interface ShareDialogState {
  open: boolean;
  session: number;
  line: ShareLine | null;
  copied: boolean;
  /** The post as the person edited it; `null` keeps the authored words. */
  text: string | null;
  /** A LinkedIn connect under way: the connection is polled until it ends. */
  watch: LinkedInConnectWatch | null;
  posting: boolean;
  /** LinkedIn's page for the post made in this opening. */
  postUrl: string | null;
}

export type ShareDialogAction =
  | { type: "open" }
  | { type: "close" }
  /** The picture on screen was replaced (`null` while the new one draws). */
  | { type: "redrawn"; url: string | null }
  | { type: "landed"; session: number; line: ShareLine | null }
  | { type: "copied" }
  | { type: "copiedDone" }
  | { type: "edited"; text: string }
  | { type: "connecting"; watch: LinkedInConnectWatch }
  /** The connect is over: landed, given up on, or never opened. */
  | { type: "watchEnded" }
  | { type: "posting" }
  | { type: "posted"; session: number; postUrl: string }
  | { type: "postRefused"; session: number; line: ShareLine | null };

export const INITIAL_SHARE_DIALOG: ShareDialogState = {
  open: false,
  session: 0,
  line: null,
  copied: false,
  text: null,
  watch: null,
  posting: false,
  postUrl: null,
};

export function shareDialogReducer(
  state: ShareDialogState,
  action: ShareDialogAction,
): ShareDialogState {
  const here = "session" in action && action.session === state.session;
  switch (action.type) {
    case "open":
      return {
        ...INITIAL_SHARE_DIALOG,
        open: true,
        session: state.session + 1,
      };
    case "close":
      return { ...state, open: false, watch: null };
    case "redrawn":
      return { ...state, line: null, copied: false };
    case "landed":
      return here ? { ...state, line: action.line } : state;
    case "copied":
      return { ...state, copied: true };
    case "copiedDone":
      return { ...state, copied: false };
    case "edited":
      return { ...state, text: action.text };
    case "connecting":
      return { ...state, watch: action.watch, line: null };
    case "watchEnded":
      return { ...state, watch: null };
    case "posting":
      return { ...state, posting: true, line: null };
    case "posted":
      return here
        ? {
            ...state,
            posting: false,
            postUrl: action.postUrl,
            line: { kind: "posted" },
          }
        : state;
    case "postRefused":
      return here ? { ...state, posting: false, line: action.line } : state;
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

/** How long clicks on Share on LinkedIn are ignored after one settled. */
export const LINKEDIN_OPEN_COOLDOWN_MS = 1000;

/**
 * The gate on opening LinkedIn: one share at a time, and none within
 * {@link LINKEDIN_OPEN_COOLDOWN_MS} of the last one starting or settling.
 * Running one at a time is not enough: an open settles in a microtask, so a
 * double click (two event turns some 50 ms apart) opened two composers. The
 * first click runs the task synchronously, inside the click. Returns whether
 * the task started; a task that throws before returning its promise
 * releases the gate and the throw is rethrown.
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
