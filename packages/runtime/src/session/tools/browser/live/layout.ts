import type { BrowserLiveLayout } from "@houston/wire-types";
import type { Page } from "playwright-core";
import type { BrowserTab } from "../open-tab";

export const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
/** A common phone's CSS viewport, so sites serve their mobile layout. */
export const PHONE_VIEWPORT = { width: 412, height: 860 } as const;

const viewportOf = (layout: BrowserLiveLayout) =>
  layout === "phone" ? PHONE_VIEWPORT : DESKTOP_VIEWPORT;

/** Size one page for the tab's current layout (a popup the tab followed). */
export async function fitPage(tab: BrowserTab, page: Page): Promise<void> {
  if (page.isClosed()) return;
  const want = viewportOf(tab.layout);
  const has = page.viewportSize();
  if (has?.width === want.width && has.height === want.height) return;
  await page.setViewportSize(want);
}

/** Switch the tab's layout and resize the page the person is looking at. */
export async function applyLayout(
  tab: BrowserTab,
  layout: BrowserLiveLayout,
): Promise<void> {
  tab.layout = layout;
  await fitPage(tab, tab.page);
}

/**
 * Back to the size the model's snapshots assume, on every page the hand-off
 * may have resized (the shown page and each popup it followed).
 */
export async function restoreLayout(tab: BrowserTab): Promise<void> {
  if (tab.layout === "desktop") return;
  tab.layout = "desktop";
  const results = await Promise.allSettled(
    tab.context.pages().map((page) => fitPage(tab, page)),
  );
  // A popup closing under the resize is not worth failing the hand-off over.
  for (const result of results)
    if (result.status === "rejected")
      console.warn("[browser] restoring a page's size failed", result.reason);
}
