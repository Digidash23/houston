import type { Browser, Request } from "playwright-core";
import { BrowserToolError } from "./errors";
import type { FenceProxy } from "./fence-proxy";
import { FENCE_HEADER } from "./fence-wire";
import type { BrowserTab } from "./open-tab";

/** Each launched browser's fence proxy (launch.ts binds them). */
const fences = new WeakMap<Browser, FenceProxy>();

/** Tabs whose page the fence stopped since their last action began. */
const refusedTabs = new WeakSet<BrowserTab>();

export function bindFence(browser: Browser, proxy: FenceProxy): void {
  fences.set(browser, proxy);
}

function fenceOf(tab: BrowserTab): FenceProxy | undefined {
  const browser = tab.context.browser();
  return browser ? fences.get(browser) : undefined;
}

/** A page's own navigation, not a frame's or a subresource's. */
function isPageNavigation(request: Request): boolean {
  if (!request.isNavigationRequest()) return false;
  try {
    return request.frame().parentFrame() === null;
  } catch (error) {
    // A popup's first navigation is issued before its frame exists, and
    // Playwright throws for its frame: it is a page's own navigation.
    if (
      error instanceof Error &&
      /^Frame for this navigation/.test(error.message)
    )
      return true;
    console.error("[browser] reading a navigation's frame failed", error);
    return false;
  }
}

function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).hostname : "";
}

/**
 * Note when the fence stops one of the tab's pages from loading: an https
 * page fails its tunnel, a plain-http one gets the proxy's 403. Either way the
 * proxy must have refused that very host just now, so a site cannot fake it.
 */
export function watchFence(tab: BrowserTab): void {
  const fence = fenceOf(tab);
  if (!fence) return;
  tab.context.on("requestfailed", (request) => {
    if (isPageNavigation(request) && fence.refused(hostOf(request.url())))
      refusedTabs.add(tab);
  });
  tab.context.on("response", (response) => {
    const request = response.request();
    if (
      isPageNavigation(request) &&
      response.headers()[FENCE_HEADER] === "refused" &&
      fence.refused(hostOf(request.url()))
    )
      refusedTabs.add(tab);
  });
}

/** Forget an earlier refusal: a new action starts. */
export function clearFenceRefusal(tab: BrowserTab): void {
  refusedTabs.delete(tab);
}

const FENCE_REFUSAL =
  "That address is not on the public web, so the browser did not open it.";

/** The model's refusal for a page the fence stopped. */
export function fenceRefusal(): BrowserToolError {
  return new BrowserToolError("url_refused", FENCE_REFUSAL);
}

/**
 * Whether the fence stopped this tab's page since the action began, or
 * refused `host` (the address an `open` asked for) just now. Reading it
 * clears it.
 */
export function takeFenceRefusal(tab: BrowserTab, host?: string): boolean {
  const hit =
    refusedTabs.has(tab) ||
    (host !== undefined && fenceOf(tab)?.refused(host) === true);
  refusedTabs.delete(tab);
  return hit;
}
