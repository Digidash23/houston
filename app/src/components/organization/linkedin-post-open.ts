import { planUrlOpenFailure } from "../../lib/url-open-failure.ts";
import type { LinkedInPostOutcome } from "./linkedin-post-run.ts";
import type { ShareDialogAction } from "./org-chart-share-state.ts";

export interface OwnPostPorts {
  /** The opening on screen now; `null` while the dialog is closed or gone. */
  onScreen: () => number | null;
  /** Whether an open no click started would reach the browser unwarned
   *  (`osCanOpenUrlUnprompted`). */
  mayOpen: () => boolean;
  /** Hands the URL to the browser (`osOpenUrl`): `false` refused, rejects
   *  when it failed. */
  open: (url: string) => Promise<boolean>;
  /** An unexpected failed open, reported with no toast. */
  report: (error: unknown) => void;
  dispatch: (action: ShareDialogAction) => void;
}

/**
 * Runs one Post from the opening on screen, and once that post is up, opens
 * it in the browser, once, if the same opening is still on screen. A post
 * replayed from the slot (a remount, another opening) never comes through
 * here. The open is not something the person asked for, so it is never
 * loud: a browser that would warn about a popup is not asked, and a machine
 * with no browser is not told. Either way View post keeps leading.
 */
export async function postAndOpen(
  run: () => Promise<LinkedInPostOutcome | null>,
  ports: OwnPostPorts,
): Promise<LinkedInPostOutcome | null> {
  const made = ports.onScreen();
  const outcome = await run();
  if (outcome?.kind !== "posted" || made === null) return outcome;
  if (ports.onScreen() !== made || !ports.mayOpen()) return outcome;
  if (await openQuietly(outcome.postUrl, ports))
    ports.dispatch({
      type: "postOpened",
      session: made,
      postUrl: outcome.postUrl,
    });
  return outcome;
}

async function openQuietly(url: string, ports: OwnPostPorts): Promise<boolean> {
  try {
    return await ports.open(url);
  } catch (error) {
    if (planUrlOpenFailure(error).surface === "report") ports.report(error);
    return false;
  }
}
