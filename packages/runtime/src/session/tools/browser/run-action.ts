import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { Locator } from "playwright-core";
import type { BrowserAction } from "./actions";
import { clearFenceRefusal } from "./fence-refusals";
import { guardLanding, openUrl, settle } from "./navigate";
import type { BrowserTab } from "./pool";
import { redactUrl } from "./redact-url";
import { resolveRef } from "./refs";
import { pageSnapshot } from "./snapshot";
import { checkBrowserUrl } from "./url-policy";

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

async function isPasswordField(field: Locator): Promise<boolean> {
  return field.evaluate(
    (el) => el instanceof HTMLInputElement && el.type === "password",
    undefined,
    {
      timeout: REF_TIMEOUT_MS,
    },
  );
}

const text = (value: string): TextContent => ({ type: "text", text: value });

/** Settles with `work`, or rejects as soon as the turn is stopped. */
function unlessAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/** Run one action on the conversation's current page and describe the result. */
export async function runBrowserAction(
  tab: BrowserTab,
  action: Exclude<BrowserAction, { action: "close" | "handoff" }>,
  signal?: AbortSignal,
): Promise<ActionOutcome> {
  const page = tab.page;
  clearFenceRefusal(tab);
  const withSnapshot = async (lead: string, mutated = true) => {
    await settle(tab.page);
    await guardLanding(tab);
    return {
      content: [text(`${lead}\n\n${await pageSnapshot(tab)}`)],
      mutated,
    };
  };
  const target = (ref: string) => page.getByRef(resolveRef(tab, ref));
  switch (action.action) {
    case "open": {
      const url = checkBrowserUrl(action.url);
      await openUrl(tab, url.href);
      return withSnapshot(`Opened ${redactUrl(url.href)}.`);
    }
    case "snapshot":
      return { content: [text(await pageSnapshot(tab))], mutated: false };
    case "click":
      await target(action.ref).click({ timeout: REF_TIMEOUT_MS });
      return withSnapshot(`Clicked ${action.ref}.`);
    case "fill": {
      const secret = await isPasswordField(target(action.ref));
      await target(action.ref).fill(action.text, { timeout: REF_TIMEOUT_MS });
      // The model may know the password; the transcript must not repeat it.
      return withSnapshot(
        secret
          ? `Filled the password field ${action.ref}.`
          : `Filled ${action.ref} with "${action.text}".`,
      );
    }
    case "select":
      await target(action.ref).selectOption(action.value, {
        timeout: REF_TIMEOUT_MS,
      });
      return withSnapshot(`Selected "${action.value}" in ${action.ref}.`);
    case "press":
      await page.keyboard.press(action.key);
      return withSnapshot(`Pressed ${action.key}.`);
    case "wait":
      await unlessAborted(
        action.text
          ? page.getByText(action.text).first().waitFor({ timeout: 15_000 })
          : page.waitForTimeout(action.ms ?? 0),
        signal,
      );
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
          text(`Screenshot of ${redactUrl(page.url())}.`),
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
