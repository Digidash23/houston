import type { Browser } from "playwright-core";

/**
 * The process's ONE local browser, launched on first use. A browser that
 * crashed or closed is forgotten, so the next use launches a fresh one.
 */
export class LocalBrowser {
  private browser: Promise<Browser> | null = null;

  constructor(private readonly launch: () => Promise<Browser>) {}

  get(): Promise<Browser> {
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

  async close(): Promise<void> {
    const browser = this.browser;
    // Cleared before awaiting, so a call arriving now launches a fresh one.
    this.browser = null;
    // A launch that failed was the refusal of the call that started it.
    await (await browser?.catch(() => undefined))?.close();
  }
}
