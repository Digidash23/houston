import type { Page, Response } from "playwright-core";
import { BrowserToolError } from "./errors";
import { fenceRefusal, takeFenceRefusal } from "./fence-refusals";
import type { BrowserTab } from "./open-tab";
import { landedSafely, refusalText } from "./url-policy";

/** Give a page a moment to finish loading; slow pages are still usable. */
export async function settle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("load", { timeout: 5_000 });
  } catch (error) {
    if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
  }
}

/**
 * Refuse a page a redirect carried somewhere the browser may not be: the
 * fence proxy stopped it (fence-refusals.ts), or it landed on a refused name.
 */
export async function guardLanding(tab: BrowserTab): Promise<void> {
  const fenced = takeFenceRefusal(tab);
  if (fenced !== null) {
    await tab.page.goto("about:blank");
    throw fenceRefusal(fenced);
  }
  const url = tab.page.url();
  if (landedSafely(url)) return;
  // Chromium's own error page: plain DNS, or a site that is down.
  if (url.startsWith("chrome-error:"))
    throw new BrowserToolError(
      "page_error",
      "That page did not load. Check the address, or try again.",
    );
  await tab.page.goto("about:blank");
  throw new BrowserToolError(
    "url_refused",
    refusalText(
      "That page sent the browser somewhere it may not go, so it was stopped.",
      URL.canParse(url) ? new URL(url).hostname : "",
    ),
  );
}

/**
 * A load that failed commits Chromium's error page a moment later, and a goto
 * issued before that is "interrupted" by it. Waiting for it here keeps one
 * failed page from failing the model's next `open` too.
 */
async function goto(page: Page, href: string): Promise<Response | null> {
  try {
    // "commit", not "domcontentloaded": a page whose head script stalls is
    // still usable, and `settle` + the snapshot already wait a bounded time.
    return await page.goto(href, { waitUntil: "commit" });
  } catch (error) {
    if (error instanceof Error && error.message.includes("net::ERR_"))
      await errorPageCommitted(page);
    throw error;
  }
}

/**
 * Open `href` in the tab, refusing it as the model's `url_refused` when the
 * fence proxy stopped the page or a hop of its redirects. Answers the main
 * document's response (null for a same-document jump).
 */
export async function openUrl(
  tab: BrowserTab,
  href: string,
): Promise<Response | null> {
  try {
    return await goto(tab.page, href);
  } catch (error) {
    const fenced = takeFenceRefusal(tab, new URL(href).hostname);
    if (fenced !== null) throw fenceRefusal(fenced);
    throw error;
  }
}

async function errorPageCommitted(page: Page): Promise<void> {
  try {
    await page.waitForURL((url) => url.protocol === "chrome-error:", {
      timeout: 2_000,
    });
  } catch (error) {
    if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
  }
}
