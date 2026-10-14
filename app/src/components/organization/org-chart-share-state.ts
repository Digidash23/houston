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
