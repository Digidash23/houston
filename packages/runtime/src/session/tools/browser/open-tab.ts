import type { Browser, Page } from "playwright-core";
import { EMPTY_STATE } from "./state-merge";
import { readState, type StateHolder } from "./state-store";

/** One conversation's window onto the web: its own cookies, its current page. */
export interface BrowserTab extends StateHolder {
  page: Page;
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
    viewport: { width: 1280, height: 800 },
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
  };
  // A link that opens a new window becomes the page the model is on.
  context.on("page", (page) => {
    tab.page = page;
  });
  return tab;
}
