import type { Page } from "playwright-core";
import { fitPage } from "./live/layout";
import { isClosedError } from "./live/page-errors";
import type { BrowserTab } from "./open-tab";
import { nextGeneration } from "./refs";

/** Tabs being closed on purpose: their last page closing is not a fallback. */
const closing = new WeakSet<BrowserTab>();

/** Close the tab's context without it reopening a page on the way out. */
export async function closeContext(tab: BrowserTab): Promise<void> {
  closing.add(tab);
  await tab.context.close();
}

/** Pages one conversation may keep open; sign-in flows open a few popups. */
export const MAX_TAB_PAGES = 8;

/**
 * The cap in turn mode: a 2 GB sandbox also runs Node and the model harness,
 * and every page is its own renderer. Three still fits a page, its sign-in
 * popup and that popup's own child.
 */
export const TURN_MAX_TAB_PAGES = 3;

type PageEnv = Record<string, string | undefined>;

export function maxTabPages(env: PageEnv): number {
  return env.HOUSTON_MODE === "turn" ? TURN_MAX_TAB_PAGES : MAX_TAB_PAGES;
}

/**
 * The tab follows the newest page: a link that opens a new window (a "Sign in
 * with Google" popup) becomes the page the model and the person are on, and
 * when that page closes the tab falls back to the last one still open. Each
 * switch retires the model's refs (a new generation) and tells the live view.
 */
export function followPages(tab: BrowserTab, maxPages: number): void {
  watchClose(tab, tab.page);
  // One trim at a time, so two popups in a row never close a page each.
  let trimming = Promise.resolve();
  tab.context.on("page", (page) => {
    watchClose(tab, page);
    switchTo(tab, page);
    trimming = trimming
      .then(() => capPages(tab, maxPages))
      .catch((error: unknown) =>
        console.warn("[browser] trimming old pages failed", error),
      );
  });
}

function watchClose(tab: BrowserTab, page: Page): void {
  page.on("close", () => {
    if (tab.page !== page || closing.has(tab)) return;
    if (!tab.context.browser()?.isConnected()) return;
    const rest = tab.context.pages().filter((p) => !p.isClosed());
    const fallback = rest.at(-1);
    if (fallback) {
      switchTo(tab, fallback);
      return;
    }
    tab.context.newPage().then(
      // The new page's own "page" event switches to it.
      () => undefined,
      (error: unknown) => {
        if (!isClosedError(error))
          console.warn("[browser] reopening a page failed", error);
      },
    );
  });
}

function switchTo(tab: BrowserTab, page: Page): void {
  tab.page = page;
  tab.generation = nextGeneration();
  fitPage(tab, page)
    .catch((error: unknown) => {
      if (!isClosedError(error))
        console.warn("[browser] sizing a new page failed", error);
    })
    .finally(() => {
      if (tab.page !== page) return;
      for (const listener of tab.onPageChange) listener(page);
    });
}

/**
 * Over the cap, close the oldest pages, but never the current page or the
 * page it was opened from: closing that opener breaks the popup's
 * `window.opener`, which is how an OAuth popup hands the sign-in back. Only
 * the DIRECT opener is kept: a page that popped up a popup that popped up
 * another would otherwise keep its whole chain open past any cap.
 */
async function capPages(tab: BrowserTab, maxPages: number): Promise<void> {
  const open = tab.context.pages().filter((p) => !p.isClosed());
  if (open.length <= maxPages) return;
  const current = tab.page;
  const opener = await current.opener();
  const kept = new Set<Page>(opener ? [current, opener] : [current]);
  const spare = open.filter((p) => !kept.has(p));
  const excess = open.length - maxPages;
  await Promise.all(
    spare.slice(0, excess).map((page) =>
      page.close().catch((error: unknown) => {
        console.warn("[browser] closing an old page failed", error);
      }),
    ),
  );
}
