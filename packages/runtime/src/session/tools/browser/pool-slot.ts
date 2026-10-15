import type { Browser } from "playwright-core";
import { CLOSE_GRACE_MS, settledWithin } from "./action-deadline";
import { dismissPending } from "./dialogs";
import { type BrowserTab, openTab } from "./open-tab";
import { saveState } from "./state-store";
import { closeContext } from "./tab-pages";

/** A conversation's place in the pool; its calls run one at a time. */
export interface Slot {
  statePath: string;
  tab: Promise<BrowserTab> | null;
  chain: Promise<void>;
  pending: number;
  lastUsed: number;
}

export function newSlot(statePath: string): Slot {
  return {
    statePath,
    tab: null,
    chain: Promise.resolve(),
    pending: 0,
    lastUsed: Date.now(),
  };
}

/** The slot's open tab, or a fresh one when it never opened or its browser died. */
export async function liveTab(
  slot: Slot,
  ensureBrowser: () => Promise<Browser>,
  maxPages: number,
): Promise<BrowserTab> {
  // A failed open already reached its own caller as a refusal; here it only
  // means "open again".
  const tab = await slot.tab?.catch(() => undefined);
  if (tab?.context.browser()?.isConnected()) {
    if (tab.page.isClosed())
      tab.page = tab.context.pages().at(-1) ?? (await tab.context.newPage());
    return tab;
  }
  const opened = ensureBrowser().then((browser) =>
    openTab(browser, slot.statePath, maxPages),
  );
  slot.tab = opened;
  return opened;
}

/**
 * Save the slot's sign-ins and close its context; the browser stays up.
 * False when the save failed or ran out of time.
 */
export async function disposeSlot(slot: Slot): Promise<boolean> {
  const pending = slot.tab;
  slot.tab = null;
  const tab = await pending?.catch(() => undefined);
  if (!tab?.context.browser()?.isConnected()) return true;
  // A page frozen behind a dialog cannot hand over its storage; a page that
  // stopped answering cannot either, so the save is bounded and the close
  // happens regardless (sign-ins were already saved after each change).
  const save = async () => {
    await dismissPending(tab);
    await saveState(tab);
  };
  try {
    return await settledWithin(
      save(),
      CLOSE_GRACE_MS,
      "saving sign-ins on close",
    );
  } finally {
    await closeContext(tab);
  }
}
