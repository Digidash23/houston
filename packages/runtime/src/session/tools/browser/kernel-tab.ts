import type { Browser } from "playwright-core";
import { backupState } from "./backup-state";
import {
  createKernelSession,
  deleteKernelSession,
  type Kernel,
  KernelError,
  kernelCode,
  kernelFrom,
} from "./kernel";
import { DESKTOP_VIEWPORT } from "./live/layout";
import { type BrowserTab, wireTab } from "./open-tab";
import { readState } from "./state-store";

/** Where a conversation's tab goes when a site blocks the local browser. */
export interface BackupBrowser {
  /** A tab loaded with `host`'s saved sign-ins (backup-state.ts). */
  open(statePath: string, maxPages: number, host: string): Promise<BrowserTab>;
}

export type ConnectOverCdp = (url: string) => Promise<Browser>;

const connectOverCdp: ConnectOverCdp = async (url) => {
  const { chromium } = await import("playwright-core");
  return chromium.connectOverCDP(url);
};

/** Kernel as the backup browser. */
export function kernelBackup(
  kernel: Kernel,
  connect: ConnectOverCdp = connectOverCdp,
): BackupBrowser {
  return {
    open: (statePath, maxPages, host) =>
      openKernelTab(kernel, statePath, maxPages, host, connect),
  };
}

/**
 * Kernel as the backup browser when the env has its key. Read on first use,
 * so the "fallback off" line is logged once, by a runtime that browses.
 */
export function backupFromEnv(
  env: Record<string, string | undefined>,
): () => BackupBrowser | null {
  let resolved: BackupBrowser | null | undefined;
  return () => {
    if (resolved === undefined) {
      const kernel = kernelFrom(env);
      resolved = kernel ? kernelBackup(kernel) : null;
    }
    return resolved;
  };
}

/**
 * One conversation's tab on its own Kernel browser, whose ONE default context
 * is what we drive: the conversation owns that browser, and closing the tab
 * closes it and deletes the session.
 *
 * What does not carry over from a local tab (open-tab.ts):
 * - The saved sign-ins are written INTO the default context, not given at
 *   creation; saving back goes to the same state.json.
 * - `acceptDownloads: false` cannot be set on an existing context; a
 *   download lands in Kernel's storage for the session.
 * - The network fence (fence-proxy.ts) cannot sit in front of a browser on
 *   Kernel's network: watchFence finds no proxy and stays off. The model's
 *   own addresses, and where a page lands, still pass url-policy.ts; what
 *   the fence protects (this machine, its private network, the metadata
 *   server) is out of a remote browser's reach anyway.
 * - Kernel sees the page, its cookies and keystrokes, a hand-off's included.
 */
export async function openKernelTab(
  kernel: Kernel,
  statePath: string,
  maxPages: number,
  host: string,
  connect: ConnectOverCdp,
): Promise<BrowserTab> {
  const session = await createKernelSession(kernel);
  let released: Promise<void> | null = null;
  const release = () => {
    released ??= deleteKernelSession(kernel, session.id).catch(
      (error: unknown) =>
        console.error(
          "[browser] ending a Kernel session failed",
          kernelCode(error),
        ),
    );
    return released;
  };
  let browser: Browser | undefined;
  try {
    browser = await connect(session.connectUrl).catch(() => {
      // Playwright's message quotes the CDP url and its session token.
      throw new KernelError("connect_failed");
    });
    // A dropped connection ends the session only after KERNEL_TIMEOUT_S;
    // deleting it stops the billing at once.
    browser.once("disconnected", () => void release());
    const context = browser.contexts()[0];
    if (!context) throw new KernelError("no_default_context");
    const stored = await readState(statePath);
    const saved = stored ? backupState(stored, host) : undefined;
    if (saved) await context.setStorageState(saved);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const tab = await wireTab(context, page, statePath, saved, maxPages);
    tab.scope = (state) => backupState(state, host);
    // A base wider than the scope would read the rest as signed out.
    tab.base = tab.scope(tab.base);
    const owned = browser;
    tab.backup = {
      host,
      dispose: async () => {
        try {
          await owned.close();
        } finally {
          await release();
        }
      },
    };
    return tab;
  } catch (error) {
    await browser?.close().catch((closing: unknown) => {
      console.error("[browser] closing a half-open Kernel browser failed", {
        name: closing instanceof Error ? closing.name : "unknown",
      });
    });
    await release();
    throw error;
  }
}
