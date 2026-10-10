import { EventEmitter } from "node:events";
import type { Page } from "playwright-core";
import type { BrowserTab } from "../open-tab";

/**
 * A CDP session that records what was sent and lets the test paint frames.
 * `hold` makes the next sends of a method wait until the test releases them.
 */
export class FakeCdp extends EventEmitter {
  sent: string[] = [];
  detached = false;
  history = { currentIndex: 1, entries: [{}, {}] };
  private readonly held = new Map<string, Promise<void>>();

  hold(method: string): () => void {
    let release: () => void = () => undefined;
    this.held.set(
      method,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => {
      this.held.delete(method);
      release();
    };
  }

  async send(method: string, params?: { text?: string }): Promise<unknown> {
    await this.held.get(method);
    this.sent.push(params?.text ? `${method}:${params.text}` : method);
    if (method === "Page.captureScreenshot") return { data: "STILL" };
    if (method === "Page.getNavigationHistory") return this.history;
    return {};
  }

  async detach(): Promise<void> {
    this.detached = true;
  }

  paint(jpeg: string): void {
    this.emit("Page.screencastFrame", {
      data: jpeg,
      sessionId: 1,
      metadata: { deviceWidth: 1280, deviceHeight: 800 },
    });
  }
}

export interface FakePage {
  closed: boolean;
  wentBack: number;
  address: string;
}

/** A page with just what the live view touches. */
export function fakePage(address = "https://site.test/login") {
  const state: FakePage = { closed: false, wentBack: 0, address };
  const frame = {};
  const page = {
    state,
    isClosed: () => state.closed,
    close: async () => {
      state.closed = true;
    },
    goBack: async () => {
      state.wentBack += 1;
      return null;
    },
    on: () => page,
    off: () => page,
    bringToFront: async () => {},
    title: async () => "Sign in",
    url: () => state.address,
    mainFrame: () => frame,
    viewportSize: () => ({ width: 1280, height: 800 }),
    setViewportSize: async () => {},
  };
  return page;
}

/** A tab over fake pages; every CDP session it opens is recorded in `sessions`. */
export function fakeTab(
  pages = [fakePage()],
  makeCdp: () => FakeCdp = () => new FakeCdp(),
) {
  const sessions: FakeCdp[] = [];
  // SAFETY: the live view touches only these members of a tab, page and context.
  const tab = {
    page: pages[0],
    context: {
      newCDPSession: async () => {
        const cdp = makeCdp();
        sessions.push(cdp);
        return cdp;
      },
      pages: () => pages.filter((p) => !p.state.closed),
    },
    generation: 0,
    layout: "desktop",
    onPageChange: new Set<(page: Page) => void>(),
  } as unknown as BrowserTab;
  return { tab, sessions, pages };
}
