import type { BrowserLiveLayout } from "@houston/wire-types";
import type { Browser, Page } from "playwright-core";
import { DESKTOP_VIEWPORT } from "./live/layout";
import { EMPTY_STATE } from "./state-merge";
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
}

/**
 * A fresh context loaded with the workspace's saved sign-ins. Its `base` is
 * what it started from, so a later save writes only what this conversation
 * changed (state-merge.ts). Downloads are refused: nothing would ever read
 * them, and they would pile up in a temp dir.
 */
export async function openTab(
  browser: Browser,
  statePath: string,
): Promise<BrowserTab> {
  const saved = await readState(statePath);
  const context = await browser.newContext({
    ...(saved ? { storageState: saved } : {}),
    viewport: DESKTOP_VIEWPORT,
    acceptDownloads: false,
  });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(30_000);
  const tab: BrowserTab = {
    context,
    page: await context.newPage(),
    statePath,
    base: {
      cookies: await context.cookies(),
      origins: saved?.origins ?? EMPTY_STATE.origins,
    },
    generation: 0,
    layout: "desktop",
    onPageChange: new Set(),
  };
  followPages(tab);
  return tab;
}
