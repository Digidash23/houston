import type { ShareDialogAction } from "./org-chart-share-state.ts";

export interface OwnPostPorts {
  /** The opening on screen now; `null` while the dialog is closed or gone. */
  onScreen: () => number | null;
  /** Whether the browser took the URL (`openExternalUrl`). */
  open: (url: string) => Promise<boolean>;
  dispatch: (action: ShareDialogAction) => void;
}

/**
 * Opens the post an opening just made, once it is up, while that opening is
 * still on screen. Called only where that opening's Post settles, once per
 * post: a post replayed from the slot (a remount, another opening) never
 * comes through here. A browser that refused the open (a popup blocker after
 * the wait) leaves View post leading.
 */
export async function openOwnPost(
  postUrl: string,
  session: number,
  ports: OwnPostPorts,
): Promise<void> {
  if (ports.onScreen() !== session) return;
  if (await ports.open(postUrl))
    ports.dispatch({ type: "postOpened", session, postUrl });
}
