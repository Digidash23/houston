import type { Browser } from "playwright-core";
import { launchBrowser } from "./launch";
import { type BrowserTab, openTab } from "./open-tab";
import { saveState } from "./state-store";

export type { BrowserTab } from "./open-tab";

/** A conversation's place in the pool; its calls run one at a time. */
interface Slot {
  statePath: string;
  tab: Promise<BrowserTab> | null;
  chain: Promise<void>;
  pending: number;
  lastUsed: number;
}

export interface BrowserPoolOptions {
  launch?: () => Promise<Browser>;
  /** How long an untouched conversation keeps its context open. */
  idleMs?: number;
}

export const BROWSER_IDLE_MS = 5 * 60_000;

/**
 * ONE browser per runtime process, launched on the first call, and one
 * BrowserContext per conversation so two chats never share a page. Calls for
 * one conversation run in order, so a `close` or an idle sweep never lands in
 * the middle of an action. A context untouched for `idleMs` is saved and
 * closed, and the browser goes with the last one. A browser that crashed, or
 * a page the site closed, is replaced on the next call.
 */
export class BrowserPool {
  private browser: Promise<Browser> | null = null;
  private readonly slots = new Map<string, Slot>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private readonly launch: () => Promise<Browser>;
  private readonly idleMs: number;

  constructor(options: BrowserPoolOptions = {}) {
    this.launch = options.launch ?? (() => launchBrowser());
    this.idleMs = options.idleMs ?? BROWSER_IDLE_MS;
  }

  /** Run `fn` on `key`'s tab after every earlier call for `key` has finished. */
  run<T>(
    key: string,
    statePath: string,
    fn: (tab: BrowserTab) => Promise<T>,
  ): Promise<T> {
    const slot = this.slots.get(key) ?? this.newSlot(key, statePath);
    return this.enqueue(slot, async () => fn(await this.liveTab(slot)));
  }

  /** Save and close one conversation's context; the browser stays up. */
  async closeTab(key: string): Promise<void> {
    const slot = this.slots.get(key);
    if (slot) await this.enqueue(slot, () => this.dispose(slot));
  }

  /** Save every context and close the browser. Safe to call twice. */
  async shutdown(): Promise<void> {
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.sweepTimer = null;
    const keys = [...this.slots.keys()];
    const results = await Promise.allSettled(keys.map((k) => this.closeTab(k)));
    for (const key of keys) this.slots.delete(key);
    await this.closeBrowser();
    for (const result of results)
      if (result.status === "rejected")
        console.error("[browser] saving sign-ins failed", result.reason);
  }

  private newSlot(key: string, statePath: string): Slot {
    const slot: Slot = {
      statePath,
      tab: null,
      chain: Promise.resolve(),
      pending: 0,
      lastUsed: Date.now(),
    };
    this.slots.set(key, slot);
    return slot;
  }

  private enqueue<T>(slot: Slot, fn: () => Promise<T>): Promise<T> {
    slot.pending += 1;
    const result = slot.chain.then(fn);
    const done = () => {
      slot.pending -= 1;
      slot.lastUsed = Date.now();
      this.armSweep();
    };
    slot.chain = result.then(done, done);
    return result;
  }

  private async liveTab(slot: Slot): Promise<BrowserTab> {
    // A failed open already reached its own caller as a refusal; here it only
    // means "open again".
    const tab = await slot.tab?.catch(() => undefined);
    if (tab?.context.browser()?.isConnected()) {
      if (tab.page.isClosed())
        tab.page = tab.context.pages().at(-1) ?? (await tab.context.newPage());
      return tab;
    }
    // Never opened, failed to open, or its browser is gone: open afresh.
    const opened = this.ensureBrowser().then((browser) =>
      openTab(browser, slot.statePath),
    );
    slot.tab = opened;
    return opened;
  }

  private async dispose(slot: Slot): Promise<void> {
    const pending = slot.tab;
    slot.tab = null;
    const tab = await pending?.catch(() => undefined);
    if (!tab?.context.browser()?.isConnected()) return;
    try {
      await saveState(tab);
    } finally {
      await tab.context.close();
    }
  }

  private armSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      this.sweep().catch((error: unknown) =>
        console.error("[browser] idle close failed", error),
      );
    }, this.idleMs);
    // The idle close must never be what keeps a finished process alive.
    this.sweepTimer.unref();
  }

  private async sweep(): Promise<void> {
    const cutoff = Date.now() - this.idleMs;
    const idle = [...this.slots].filter(
      ([, slot]) => slot.pending === 0 && slot.lastUsed <= cutoff,
    );
    await Promise.all(idle.map(([key]) => this.closeTab(key)));
    for (const [key, slot] of idle)
      if (slot.pending === 0 && !slot.tab) this.slots.delete(key);
    if (this.slots.size === 0) await this.closeBrowser();
    else this.armSweep();
  }

  private async closeBrowser(): Promise<void> {
    const browser = this.browser;
    // Cleared before awaiting, so a call arriving now launches a fresh one.
    this.browser = null;
    // A launch that failed was the refusal of the call that started it.
    await (await browser?.catch(() => undefined))?.close();
  }

  private ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      const launching = this.launch();
      this.browser = launching;
      const forget = () => {
        if (this.browser === launching) this.browser = null;
      };
      launching.then((browser) => browser.on("disconnected", forget), forget);
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
