import { sep } from "node:path";
import type { Browser } from "playwright-core";
import { launchBrowser } from "./launch";
import type { BrowserTab } from "./open-tab";
import { disposeSlot, liveTab, newSlot, type Slot } from "./pool-slot";

export type { BrowserTab } from "./open-tab";

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

  /**
   * Run `fn` on `key`'s tab after every earlier call for `key` has finished.
   * A call whose turn was stopped while it queued is dropped, not run.
   */
  run<T>(
    key: string,
    statePath: string,
    fn: (tab: BrowserTab) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let slot = this.slots.get(key);
    if (!slot) {
      slot = newSlot(statePath);
      this.slots.set(key, slot);
    }
    const queued = slot;
    return this.enqueue(queued, async () => {
      signal?.throwIfAborted();
      return fn(await liveTab(queued, () => this.ensureBrowser()));
    });
  }

  /**
   * Mark `key` as in use without queueing: a person driving the page through
   * the live view acts on it directly while the hand-off holds the queue.
   */
  touch(key: string): void {
    const slot = this.slots.get(key);
    if (slot) slot.lastUsed = Date.now();
  }

  /** Save and close one conversation's context; the browser stays up. */
  async closeTab(key: string): Promise<void> {
    const slot = this.slots.get(key);
    if (slot) await this.enqueue(slot, () => disposeSlot(slot));
  }

  /**
   * Save and close every context whose sign-ins live under `dir`, and forget
   * them: a pooled turn's workspace is about to be deleted, and a context left
   * open would outlive it (and a later save would write into a removed tree).
   * Waits behind each one's running call. Failures are logged, never thrown,
   * so the caller's cleanup goes on.
   */
  async closeUnder(dir: string): Promise<void> {
    const prefix = dir.endsWith(sep) ? dir : `${dir}${sep}`;
    const keys = [...this.slots]
      .filter(([, slot]) => slot.statePath.startsWith(prefix))
      .map(([key]) => key);
    const results = await Promise.allSettled(
      keys.map((key) => this.closeTab(key)),
    );
    for (const key of keys) {
      const slot = this.slots.get(key);
      if (slot?.pending === 0 && !slot.tab) this.slots.delete(key);
    }
    for (const result of results)
      if (result.status === "rejected")
        console.error(
          "[browser] closing a turn's browser failed",
          result.reason,
        );
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
