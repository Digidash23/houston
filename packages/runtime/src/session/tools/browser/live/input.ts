import type { BrowserLiveInput } from "@houston/wire-types";
import type { CDPSession, Page } from "playwright-core";
import { BrowserToolError } from "../errors";
import type { BrowserTab } from "../open-tab";
import { checkBrowserUrl } from "../url-policy";
import { keyPress } from "./keys";
import { DESKTOP_VIEWPORT } from "./layout";
import { isClosedError, warnUnlessClosed } from "./page-errors";

/** A navigation from the live view returns once it commits, never later. */
const NAVIGATE_TIMEOUT_MS = 15_000;

const MOUSE_TYPE = {
  move: "mouseMoved",
  down: "mousePressed",
  up: "mouseReleased",
} as const;

export interface InputOutcome {
  refused?: "url_refused";
}

/**
 * Applies the person's input to the tab's CURRENT page over its own CDP
 * session, never through the pool's queue: the hand-off holds that queue for
 * as long as the person is driving. Typed text and addresses are never logged.
 */
export class LiveInput {
  private bound: { page: Page; session: Promise<CDPSession> } | null = null;

  constructor(private readonly tab: BrowserTab) {}

  async apply(events: readonly BrowserLiveInput[]): Promise<InputOutcome> {
    let outcome: InputOutcome = {};
    for (const event of events) {
      try {
        if ((await this.one(event)) === "url_refused")
          outcome = { refused: "url_refused" };
      } catch (error) {
        // The page closed under the person's click (a popup finishing its
        // sign-in): the tab already moved on, so the rest of the batch goes there.
        if (!isClosedError(error)) throw error;
        this.bound = null;
      }
    }
    return outcome;
  }

  private async one(
    event: BrowserLiveInput,
  ): Promise<"url_refused" | undefined> {
    switch (event.type) {
      case "mouse":
        await this.mouse(event);
        return undefined;
      case "wheel":
        await (await this.session()).send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          ...this.px(event),
          deltaX: event.dx,
          deltaY: event.dy,
        });
        return;
      case "key":
        for (const params of keyPress(event.key, event.modifiers ?? 0))
          await (await this.session()).send("Input.dispatchKeyEvent", params);
        return;
      case "text":
        if (event.text)
          await (await this.session()).send("Input.insertText", {
            text: event.text,
          });
        return;
      case "navigate":
        return this.navigate(event.url);
      case "back":
        await this.back();
        return undefined;
    }
  }

  private async mouse(
    event: Extract<BrowserLiveInput, { type: "mouse" }>,
  ): Promise<void> {
    const at = this.px(event);
    const clickCount = event.clickCount ?? 1;
    const cdp = await this.session();
    if (event.action === "click") {
      for (const type of [
        "mouseMoved",
        "mousePressed",
        "mouseReleased",
      ] as const)
        await cdp.send("Input.dispatchMouseEvent", {
          type,
          ...at,
          button: type === "mouseMoved" ? "none" : "left",
          clickCount,
        });
      return;
    }
    const pressed = event.buttons === 1;
    await cdp.send("Input.dispatchMouseEvent", {
      type: MOUSE_TYPE[event.action],
      ...at,
      button: event.action === "move" && !pressed ? "none" : "left",
      buttons: pressed ? 1 : 0,
      clickCount,
    });
  }

  private async navigate(raw: string): Promise<"url_refused" | undefined> {
    let href: string;
    try {
      href = checkBrowserUrl(raw).href;
    } catch (error) {
      if (error instanceof BrowserToolError) return "url_refused";
      throw error;
    }
    // "commit", not "load": input applies in order, so waiting for a slow page
    // would freeze every click and keystroke queued behind it. A page that
    // fails to load shows its own error in the picture.
    await this.tab.page
      .goto(href, { waitUntil: "commit", timeout: NAVIGATE_TIMEOUT_MS })
      .catch(warnUnlessClosed("live view navigation"));
    return undefined;
  }

  /** A popup or new tab has no history: Back closes it, showing the one below. */
  private async back(): Promise<void> {
    const page = this.tab.page;
    const depth = await page.evaluate(() => history.length);
    const open = this.tab.context.pages().filter((p) => !p.isClosed());
    if (depth <= 1 && open.length > 1) {
      await page.close();
      return;
    }
    await page
      .goBack({ waitUntil: "commit", timeout: NAVIGATE_TIMEOUT_MS })
      .catch(warnUnlessClosed("live view back"));
  }

  /** 0..1 of the frame, scaled by the shown page's own viewport. */
  private px(point: { x: number; y: number }): { x: number; y: number } {
    const size = this.tab.page.viewportSize() ?? DESKTOP_VIEWPORT;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return {
      x: Math.round(clamp(point.x) * size.width),
      y: Math.round(clamp(point.y) * size.height),
    };
  }

  private session(): Promise<CDPSession> {
    const page = this.tab.page;
    if (this.bound?.page !== page) {
      const old = this.bound?.session;
      this.bound = { page, session: this.tab.context.newCDPSession(page) };
      old
        ?.then((session) => session.detach())
        .catch(warnUnlessClosed("input detach"));
    }
    return this.bound.session;
  }

  /** Drop the CDP session (the hand-off ended). */
  async close(): Promise<void> {
    const bound = this.bound;
    this.bound = null;
    await bound?.session
      .then((session) => session.detach())
      .catch(warnUnlessClosed("input detach"));
  }
}
