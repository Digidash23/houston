import type { Page } from "@playwright/test";
import { FOLLOW_UP_PLACEHOLDER } from "./support/composer";
import { expect, test } from "./support/fixtures";
import { missionCard } from "./support/team-nav";

/**
 * A send right after the app comes back from the background (H-055).
 *
 * Returning from the background reconnects the global event stream, and the
 * app re-reads every mounted query, the provider catalog included. The
 * composer's send pin waits until its inputs have settled (PRODUCT-1771), and
 * the provider-status probe is one of them. That probe answers slowly through
 * the gateway, so a background re-read of it must never put an already
 * settled composer back into waiting: the send used to sit out the full 15 s
 * settle timeout.
 *
 * The cloud adapter raises `EventStreamReconnected` itself when its stream
 * comes back; the host-mode harness has no such drop, so the spec pushes the
 * same event through the host feed after a real offline and hidden spell.
 */
const PROBE_HOLD_MS = 20_000;
/** Far under the 15 s settle timeout, generous for a contended CI runner. */
const SEND_GRACE_MS = 5_000;

async function setVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => s,
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => s === "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("a send after the app returns from the background goes out at once", async ({
  page,
  context,
  emitHostEvent,
}) => {
  const pinTimeouts: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("chat.send-pin-settle")) pinTimeouts.push(m.text());
  });
  await page.goto("/");
  await missionCard(page, "Plan a trip to Tokyo").click();
  const composer = page.getByPlaceholder(FOLLOW_UP_PLACEHOLDER);
  await expect(composer).toBeVisible();

  // From here on the provider probe answers as slowly as a waking pod.
  await page.route(/\/providers(\?|$)/, async (route) => {
    await new Promise((r) => setTimeout(r, PROBE_HOLD_MS));
    // The test may end, closing the page, before the hold lifts.
    await route.continue().catch(() => {});
  });

  await setVisibility(page, "hidden");
  await context.setOffline(true);
  await context.setOffline(false);
  await setVisibility(page, "visible");
  // The host feed only reaches a connected stream, so the event is re-sent
  // until the app has acted on it (its catalog re-read).
  await expect(async () => {
    const catalogReread = page.waitForResponse(/\/v1\/catalog$/, {
      timeout: 2_000,
    });
    await emitHostEvent("EventStreamReconnected");
    await catalogReread;
  }).toPass({ timeout: 15_000 });

  const sent = page.waitForRequest(
    (r) =>
      r.method() === "POST" &&
      /\/conversations\//.test(r.url()) &&
      !r.url().endsWith("/prewarm"),
  );
  const started = Date.now();
  await composer.fill("back from the background");
  await composer.press("Enter");
  await sent;

  expect(Date.now() - started).toBeLessThan(SEND_GRACE_MS);
  expect(pinTimeouts).toEqual([]);
});
