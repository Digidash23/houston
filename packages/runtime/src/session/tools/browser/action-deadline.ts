import { BrowserToolError } from "./errors";
import type { Slot } from "./pool-slot";
import { closeContext } from "./tab-pages";

/**
 * How long one browser action may take, start to finish. Playwright bounds
 * navigation (30 s) and element waits, but not `page.evaluate` or a renderer
 * that freezes mid-load: a frozen page held a turn's `open` for 6 minutes.
 */
export const ACTION_DEADLINE_MS = 60_000;

/** How long closing a stuck context may take before it is left behind. */
export const CLOSE_GRACE_MS = 10_000;

class DeadlineExceeded extends Error {}

/**
 * `work` within `ms`, or the slot's context closed and a refusal the model can
 * act on. Closing the context is what ends the stuck call: it holds the page,
 * and the queue behind it would otherwise wait for it forever.
 */
export async function withinDeadline<T>(
  slot: Slot,
  work: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded()), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } catch (error) {
    if (!(error instanceof DeadlineExceeded)) throw error;
    // The stuck call rejects once its context closes; that end is expected.
    work.catch((reason: unknown) =>
      console.warn("[browser] a stuck action ended", String(reason)),
    );
    await abandon(slot);
    throw new BrowserToolError(
      "page_unresponsive",
      `The page stopped responding for ${Math.round(ms / 1000)} seconds, so the browser closed it. Sign-ins saved before this step are kept. Open the page again, or tell the person the site is not responding.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether `work` settled within `ms`. A step that never settles is left
 * behind, logged as `what`: used where a frozen page must not block a close.
 */
export async function settledWithin(
  work: Promise<unknown>,
  ms: number,
  what: string,
): Promise<boolean> {
  let grace: NodeJS.Timeout | undefined;
  const settled = await Promise.race([
    work.then(
      () => true,
      (error: unknown) => {
        console.error(`[browser] ${what} failed`, error);
        return true;
      },
    ),
    new Promise<false>((resolve) => {
      grace = setTimeout(() => resolve(false), ms);
    }),
  ]);
  clearTimeout(grace);
  if (!settled) console.error(`[browser] ${what} did not finish; left behind`);
  return settled;
}

/**
 * Drop the slot's tab without saving: a frozen page cannot hand over its
 * storage. Bounded as a whole, since the stuck step may be the tab's own
 * opening; a context that will not close is left to the browser's exit.
 */
async function abandon(slot: Slot): Promise<void> {
  const pending = slot.tab;
  slot.tab = null;
  const close = async () => {
    // A failed open already reached its caller; here it means nothing to close.
    const tab = await pending?.catch(() => undefined);
    if (tab) await closeContext(tab);
  };
  await settledWithin(close(), CLOSE_GRACE_MS, "closing a stuck context");
}
