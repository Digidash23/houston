import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { Page } from "playwright-core";
import type { BrowserAction } from "./actions";
import { BrowserToolError } from "./errors";
import type { BrowserTab } from "./pool";
import { pageSnapshot } from "./snapshot";
import { checkBrowserUrl, landedSafely } from "./url-policy";

/**
 * A ref names an element the latest snapshot saw, so one that is not there now
 * is stale: say so fast instead of waiting out the 15 s default.
 */
const REF_TIMEOUT_MS = 5_000;

export interface ActionOutcome {
  content: (TextContent | ImageContent)[];
  /** The action may have changed sign-ins, so the state is saved after it. */
  mutated: boolean;
}

/** Give a page a moment to finish loading; slow pages are still usable. */
async function settle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("load", { timeout: 5_000 });
  } catch (error) {
    if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
  }
}

async function isPasswordField(page: Page, ref: string): Promise<boolean> {
  return page
    .getByRef(ref)
    .evaluate(
      (el) => el instanceof HTMLInputElement && el.type === "password",
      undefined,
      {
        timeout: REF_TIMEOUT_MS,
      },
    );
}

/** Refuse a page a redirect carried somewhere the browser may not be. */
async function guardLanding(
  page: Page,
  blocked: readonly string[],
): Promise<void> {
  if (landedSafely(page.url(), blocked)) return;
  await page.goto("about:blank");
  throw new BrowserToolError(
    "url_refused",
    "That page sent the browser somewhere it may not go, so it was stopped.",
  );
}

const text = (value: string): TextContent => ({ type: "text", text: value });

/** Run one action on the conversation's current page and describe the result. */
export async function runBrowserAction(
  tab: BrowserTab,
  action: Exclude<BrowserAction, { action: "close" }>,
  blocked: readonly string[],
): Promise<ActionOutcome> {
  const page = tab.page;
  const withSnapshot = async (lead: string, mutated = true) => {
    await settle(tab.page);
    await guardLanding(tab.page, blocked);
    return {
      content: [text(`${lead}\n\n${await pageSnapshot(tab.page)}`)],
      mutated,
    };
  };
  switch (action.action) {
    case "open": {
      const url = checkBrowserUrl(action.url, blocked);
      await page.goto(url.href, { waitUntil: "domcontentloaded" });
      return withSnapshot(`Opened ${url.href}.`);
    }
    case "snapshot":
      return { content: [text(await pageSnapshot(page))], mutated: false };
    case "click":
      await page.getByRef(action.ref).click({ timeout: REF_TIMEOUT_MS });
      return withSnapshot(`Clicked ${action.ref}.`);
    case "fill": {
      const secret = await isPasswordField(page, action.ref);
      await page
        .getByRef(action.ref)
        .fill(action.text, { timeout: REF_TIMEOUT_MS });
      // The model may know the password; the transcript must not repeat it.
      return withSnapshot(
        secret
          ? `Filled the password field ${action.ref}.`
          : `Filled ${action.ref} with "${action.text}".`,
      );
    }
    case "select":
      await page
        .getByRef(action.ref)
        .selectOption(action.value, { timeout: REF_TIMEOUT_MS });
      return withSnapshot(`Selected "${action.value}" in ${action.ref}.`);
    case "press":
      await page.keyboard.press(action.key);
      return withSnapshot(`Pressed ${action.key}.`);
    case "wait":
      if (action.text)
        await page.getByText(action.text).first().waitFor({ timeout: 15_000 });
      else await page.waitForTimeout(action.ms ?? 0);
      return withSnapshot(
        action.text
          ? `"${action.text}" is on the page.`
          : `Waited ${action.ms} ms.`,
        false,
      );
    case "back":
      await page.goBack({ waitUntil: "domcontentloaded" });
      return withSnapshot("Went back.");
    case "screenshot": {
      const image = await page.screenshot({ type: "jpeg", quality: 60 });
      return {
        content: [
          text(`Screenshot of ${page.url()}.`),
          {
            type: "image",
            data: image.toString("base64"),
            mimeType: "image/jpeg",
          },
        ],
        mutated: false,
      };
    }
  }
}
