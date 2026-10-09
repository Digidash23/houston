import type { Browser, BrowserContext, Page } from "playwright-core";
import { launchBrowser } from "./launch";
import { readableState, saveState } from "./state-store";

/** One conversation's window onto the web: its own cookies, its current page. */
export interface BrowserTab {
  context: BrowserContext;
  page: Page;
  statePath: string;
}

export interface BrowserPoolOptions {
  launch?: () => Promise<Browser>;
  /** How long an untouched browser stays up before it is closed. */
  idleMs?: number;
}

export const BROWSER_IDLE_MS = 5 * 60_000;

/**
 * ONE browser per runtime process, launched on the first call, and one
 * BrowserContext per conversation so two chats never share a page. Each new
 * context starts from the workspace's saved sign-ins; the tool saves after
 * every action that can change them, so an idle close or a process exit loses
 * nothing that was already saved.
 */
export class BrowserPool {
  private browser: Promise<Browser> | null = null;
  private readonly tabs = new Map<string, Promise<BrowserTab>>();
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly launch: () => Promise<Browser>;
  private readonly idleMs: number;

  constructor(options: BrowserPoolOptions = {}) {
    this.launch = options.launch ?? (() => launchBrowser());
    this.idleMs = options.idleMs ?? BROWSER_IDLE_MS;
  }

  /** The tab for `key`, opening the browser and the context as needed. */
  tab(key: string, statePath: string): Promise<BrowserTab> {
    this.touch();
    const existing = this.tabs.get(key);
    if (existing) return existing;
    const opened = this.openTab(statePath);
    this.tabs.set(key, opened);
    // A failed open must not stick: the next call tries again.
    opened.catch(() => this.tabs.delete(key));
    return opened;
  }

  /** Save and close one conversation's context; the browser stays up. */
  async closeTab(key: string): Promise<void> {
    const pending = this.tabs.get(key);
    if (!pending) return;
    this.tabs.delete(key);
    const tab = await pending;
    await saveState(tab.context, tab.statePath);
    await tab.context.close();
  }

  /** Save every context and close the browser. Safe to call twice. */
  async shutdown(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const keys = [...this.tabs.keys()];
    const results = await Promise.allSettled(keys.map((k) => this.closeTab(k)));
    const browser = this.browser;
    this.browser = null;
    if (browser) await (await browser).close();
    for (const result of results)
      if (result.status === "rejected")
        console.error(
          "[browser] saving sign-ins on close failed",
          result.reason,
        );
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.shutdown().catch((error: unknown) =>
        console.error("[browser] idle close failed", error),
      );
    }, this.idleMs);
    // The idle close must never be what keeps a finished process alive.
    this.idleTimer.unref();
  }

  private async openTab(statePath: string): Promise<BrowserTab> {
    const browser = await this.ensureBrowser();
    const storageState = await readableState(statePath);
    const context = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      viewport: { width: 1280, height: 800 },
    });
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(30_000);
    const tab: BrowserTab = {
      context,
      page: await context.newPage(),
      statePath,
    };
    // A link that opens a new window becomes the page the model is on.
    context.on("page", (page) => {
      tab.page = page;
    });
    return tab;
  }

  private ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      const launching = this.launch();
      this.browser = launching;
      launching.then(
        (browser) =>
          browser.on("disconnected", () => {
            if (this.browser === launching) this.browser = null;
            this.tabs.clear();
          }),
        () => {
          if (this.browser === launching) this.browser = null;
        },
      );
    }
    return this.browser;
  }
}

/** The process-wide pool every `browser` tool instance shares. */
export const sharedBrowserPool = new BrowserPool();

// Scripts end through beforeExit; a server's SIGTERM path exits hard, and
// Playwright's own exit hook kills the child there (state is already saved).
process.once("beforeExit", () => {
  sharedBrowserPool
    .shutdown()
    .catch((error: unknown) =>
      console.error("[browser] exit close failed", error),
    );
});
