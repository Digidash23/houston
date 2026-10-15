import type { BrowserLiveLayout } from "@houston/wire-types";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { watchDialogs } from "./dialogs";
import { watchFence } from "./fence-refusals";
import { DESKTOP_VIEWPORT } from "./live/layout";
import { EMPTY_STATE, type StorageState } from "./state-merge";
import { readState, type StateHolder } from "./state-store";
import { followPages } from "./tab-pages";

/** One conversation's window onto the web: its own cookies, its current page. */
export interface BrowserTab extends StateHolder {
  page: Page;
  /** The latest snapshot's ref prefix (refs.ts); 0 before the first one. */
  generation: number;
  /** How the page is sized: a person on a phone gets a phone viewport. */
  layout: BrowserLiveLayout;
  /** Told whenever `page` changes to another page (a popup, a closed tab). */
  onPageChange: Set<(page: Page) => void>;
  /**
   * Set when the tab runs on the backup browser (kernel-tab.ts): the site it
   * was opened for, and how its whole remote browser goes away.
   */
  backup?: { host: string; dispose: () => Promise<void> };
}

/**
 * A fresh context loaded with the workspace's saved sign-ins. Its `base` is
 * what it started from, so a later save writes only what this conversation
 * changed (state-merge.ts). Downloads are refused: nothing would ever read
 * them, and they would pile up in a temp dir. `maxPages` caps the popups it
 * keeps (tab-pages.ts).
 */
export async function openTab(
  browser: Browser,
  statePath: string,
  maxPages: number,
): Promise<BrowserTab> {
  const saved = await readState(statePath);
  const context = await browser.newContext({
    ...(saved ? { storageState: saved } : {}),
    viewport: DESKTOP_VIEWPORT,
    acceptDownloads: false,
  });
  return wireTab(context, await context.newPage(), statePath, saved, maxPages);
}

/** The tab every opener builds once it has a context and its first page. */
export async function wireTab(
  context: BrowserContext,
  page: Page,
  statePath: string,
  saved: StorageState | undefined,
  maxPages: number,
): Promise<BrowserTab> {
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(30_000);
  const tab: BrowserTab = {
    context,
    page,
    statePath,
    base: {
      cookies: await context.cookies(),
      origins: saved?.origins ?? EMPTY_STATE.origins,
    },
    generation: 0,
    layout: "desktop",
    onPageChange: new Set(),
  };
  followPages(tab, maxPages);
  watchFence(tab);
  watchDialogs(tab);
  return tab;
}
