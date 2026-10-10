import type { BrowserLiveInput } from "@houston/wire-types";
import type { CDPSession, Page } from "playwright-core";
import { BrowserToolError } from "../errors";
import type { BrowserTab } from "../open-tab";
import { checkBrowserUrl } from "../url-policy";
import { CDP_STEP_MS, within } from "./cdp-step";
import { keyPress, mouseSteps } from "./keys";
import { DESKTOP_VIEWPORT } from "./layout";
import { isClosedError, warnUnlessClosed } from "./page-errors";

/** A navigation from the live view returns once it commits, never later. */
const NAVIGATE_TIMEOUT_MS = 15_000;

export interface InputOutcome {
  refused?: "url_refused";
}

/** Input arriving after the hand-off ended: the page is the agent's again. */
class InputClosedError extends Error {}

/**
 * Applies the person's input to the tab's CURRENT page over its own CDP
 * session, never through the pool's queue: the hand-off holds that queue for
 * as long as the person is driving. Typed text and addresses are never logged.
 * Every CDP step is bounded ({@link within}), and once closed nothing more
 * reaches the page, not even the rest of a batch already running.
 */
export class LiveInput {
  private bound: { page: Page; session: Promise<CDPSession> } | null = null;
  private closed = false;

  constructor(
    private readonly tab: BrowserTab,
    private readonly stepMs = CDP_STEP_MS,
  ) {}

  async apply(events: readonly BrowserLiveInput[]): Promise<InputOutcome> {
    let outcome: InputOutcome = {};
    for (const event of events) {
      if (this.closed) break;
      try {
        if ((await this.one(event)) === "url_refused")
          outcome = { refused: "url_refused" };
      } catch (error) {
        if (error instanceof InputClosedError) break;
        // The page closed under the person's click (a popup finishing its
        // sign-in): the tab already moved on, so the rest of the batch goes there.
        if (!isClosedError(error)) throw error;
        this.bound = null;
      }
    }
    return outcome;
  }

  /** One bounded CDP call on the current page's session. */
  private async send(
    ...[method, params]: Parameters<CDPSession["send"]>
  ): Promise<void> {
    const cdp = await this.session();
    await within(cdp.send(method, params), method, this.stepMs);
  }

  private async one(
    event: BrowserLiveInput,
  ): Promise<"url_refused" | undefined> {
    switch (event.type) {
      case "mouse":
        await this.mouse(event);
        return undefined;
      case "wheel":
        await this.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          ...this.px(event),
          deltaX: event.dx,
          deltaY: event.dy,
        });
        return;
      case "key":
        for (const params of keyPress(event.key, event.modifiers ?? 0))
          await this.send("Input.dispatchKeyEvent", params);
        return;
      case "text":
        if (event.text)
          await this.send("Input.insertText", { text: event.text });
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
    for (const params of mouseSteps(event, this.px(event)))
      await this.send("Input.dispatchMouseEvent", params);
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

  /**
   * A popup or new tab has no history: Back closes it, showing the one below.
   * The browser's own record of the page's history, never the page's word
   * for it: a page script can fake `history.length` or stall `evaluate`.
   */
  private async back(): Promise<void> {
    const page = this.tab.page;
    const cdp = await this.session();
    const { currentIndex } = await within(
      cdp.send("Page.getNavigationHistory"),
      "history",
      this.stepMs,
    );
    const open = this.tab.context.pages().filter((p) => !p.isClosed());
    if (currentIndex <= 0 && open.length > 1) {
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
    if (this.closed) throw new InputClosedError("the hand-off has ended");
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

  /** Refuse all further input and drop the CDP session (the hand-off ended). */
  async close(): Promise<void> {
    this.closed = true;
    const bound = this.bound;
    this.bound = null;
    await bound?.session
      .then((session) => session.detach())
      .catch(warnUnlessClosed("input detach"));
  }
}
