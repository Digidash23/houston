import type { Page } from "playwright-core";
import type { BrowserTab } from "./open-tab";

/** Past this many elements a page is not compared: no `[new]` marks. */
export const MAX_REMEMBERED_REFS = 20_000;

interface LastLook {
  page: Page;
  /** The main-frame document (performance.timeOrigin), not just its URL. */
  document: number;
  refs: ReadonlySet<string>;
}

const lastLooks = new WeakMap<BrowserTab, LastLook>();
const epochs = new WeakMap<BrowserTab, number>();

/**
 * Which document the page shows: `performance.timeOrigin` is minted per
 * document, so it changes on every navigation and stays across pushState.
 * Playwright's refs are stable per element only within one document.
 */
export async function documentOf(page: Page): Promise<number> {
  return page.evaluate(() => performance.timeOrigin);
}

/** The refs of the previous look, when it was at this same document. */
export function previousRefs(
  tab: BrowserTab,
  page: Page,
  document: number,
): ReadonlySet<string> | undefined {
  const last = lastLooks.get(tab);
  return last?.page === page && last.document === document
    ? last.refs
    : undefined;
}

export function rememberLook(
  tab: BrowserTab,
  page: Page,
  document: number,
  refs: ReadonlySet<string>,
): void {
  if (refs.size > MAX_REMEMBERED_REFS) lastLooks.delete(tab);
  else lastLooks.set(tab, { page, document, refs });
}

/**
 * A look started before a dialog interrupted its action finishes only once
 * the dialog is answered, after newer looks: it must not then retire their
 * refs. Each look takes the epoch when it starts and commits only if no
 * dialog superseded it meanwhile.
 */
export function lookEpoch(tab: BrowserTab): number {
  return epochs.get(tab) ?? 0;
}

export function supersedeLooks(tab: BrowserTab): void {
  epochs.set(tab, lookEpoch(tab) + 1);
}

/** Thrown by work a dialog interrupted, so it stops instead of finishing late. */
export class SupersededError extends Error {
  constructor() {
    super("A dialog interrupted this action; a newer one has the page.");
    this.name = "SupersededError";
  }
}
