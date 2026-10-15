import type { BrowserAction } from "./actions";
import { type Block, connectionBlock } from "./block-detect";
import { BrowserToolError } from "./errors";
import { kernelCode } from "./kernel";
import type { BrowserTab } from "./open-tab";
import {
  type ActionOutcome,
  type PageAction,
  runBrowserAction,
} from "./run-action";
import { SlotAbandoned, type TabSwap } from "./tab-swap";
import { checkBrowserUrl } from "./url-policy";

type OpenAction = Extract<BrowserAction, { action: "open" }>;

export const BACKUP_NOTE =
  "This site blocks automated browsers, so the page was opened through the backup browser.";
export const BLOCKED_NOTE =
  "This site blocks automated browsers, and the backup browser could not open it either. Tell the person in the chat that the site blocked the browser; do not hand the browser over for it.";

/** The tab the action ended on (the backup's, after a move) and its result. */
export interface Acted {
  tab: BrowserTab;
  outcome: ActionOutcome;
}

/** Run one page action; an `open` may move the conversation (below). */
export async function actOn(
  tab: BrowserTab,
  action: PageAction,
  swap: TabSwap,
  signal?: AbortSignal,
): Promise<Acted> {
  if (action.action === "open")
    return openWithFallback(tab, action, swap, signal);
  return { tab, outcome: await runBrowserAction(tab, action, signal) };
}

/**
 * Open a page here, and when the site's anti-bot wall blocks this browser,
 * open it again on the backup browser (Kernel) and move the conversation
 * there. A conversation on the backup stays there for that site; an `open`
 * of another site brings it back here first, since the backup is paid and
 * its proxy refuses some sites this browser reaches (government sites).
 * With no backup (no KERNEL_API_KEY), this is exactly a plain `open`.
 */
export async function openWithFallback(
  tab: BrowserTab,
  action: OpenAction,
  swap: TabSwap,
  signal?: AbortSignal,
): Promise<Acted> {
  let current = tab;
  if (current.backup) {
    const host = checkBrowserUrl(action.url).hostname;
    if (siteOf(host) === siteOf(current.backup.host))
      return { tab, outcome: await runBrowserAction(tab, action, signal) };
    current = await swap.reopenLocal();
  }
  if (!swap.openBackup)
    return {
      tab: current,
      outcome: await runBrowserAction(current, action, signal),
    };
  let local: ActionOutcome;
  try {
    local = await runBrowserAction(current, action, signal, true);
  } catch (error) {
    const block = connectionBlock(error);
    if (!block) throw error;
    const moved = await tryBackup(action, swap, block, signal);
    if (moved) return moved;
    throw new BrowserToolError("page_error", BLOCKED_NOTE);
  }
  if (!local.blocked) return { tab: current, outcome: local };
  const moved = await tryBackup(action, swap, local.blocked, signal);
  return moved ?? { tab: current, outcome: withNote(local, BLOCKED_NOTE) };
}

/**
 * The page on a backup tab, adopted as the conversation's; null (logged)
 * when the backup refused, failed, or was blocked too: the local result
 * stands. A stopped turn is passed on, not counted as a refusal.
 */
async function tryBackup(
  action: OpenAction,
  swap: TabSwap,
  block: Block,
  signal?: AbortSignal,
): Promise<Acted | null> {
  const host = checkBrowserUrl(action.url).hostname;
  console.warn(
    `[browser] ${host} blocked the browser (${block.reason}); trying Kernel`,
  );
  try {
    if (!swap.openBackup) return null;
    // Not saved first: what the blocked visit added is the wall's own
    // marking of this browser, and it gets the backup blocked too. Earlier
    // sign-ins were already saved after the action that made them.
    const backup = await swap.openBackup(host);
    const outcome = await runBrowserAction(backup, action, signal, true);
    if (outcome.blocked) throw new StillBlocked(outcome.blocked);
    await swap.adopt(backup);
    return { tab: backup, outcome: withNote(outcome, BACKUP_NOTE) };
  } catch (error) {
    await swap.dropBackup();
    if (signal?.aborted) throw error;
    // A site that walls Kernel too is the web, and an abandoned call already
    // reached the model as its deadline: neither is a fault (no Sentry event).
    const expected =
      error instanceof StillBlocked || error instanceof SlotAbandoned;
    const log = expected ? console.warn : console.error;
    log(`[browser] Kernel fallback failed for ${host}`, failureCode(error));
    return null;
  }
}

class StillBlocked extends Error {
  constructor(readonly block: Block) {
    super("the backup browser was blocked too");
  }
}

function failureCode(error: unknown): string {
  if (error instanceof StillBlocked)
    return error.block.reason === "backup_proxy"
      ? error.block.code
      : `still_blocked:${error.block.reason}`;
  if (error instanceof BrowserToolError) return `tool:${error.code}`;
  return kernelCode(error);
}

function withNote(outcome: ActionOutcome, note: string): ActionOutcome {
  return {
    ...outcome,
    content: [{ type: "text", text: note }, ...outcome.content],
  };
}

/** A site's name for staying on the backup: `www.` is the same site. */
function siteOf(host: string): string {
  return host.replace(/^www\./, "");
}
