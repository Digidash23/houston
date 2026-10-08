import { FAKE_HOST_URL } from "@houston/fake-host";
import type { APIRequestContext, Page } from "@playwright/test";
import { seedPage } from "./seed";

/**
 * Interrupting the first-run closing while its save is in flight.
 *
 * Onboarding finishes only once its conversation is written into the manager's
 * chat (the import), so holding that import on the fake host keeps the person
 * on the closing for as long as a spec needs. Held by the host, never by the
 * browser: a request the browser pauses outlives a reload and stalls the
 * reloaded page.
 */

/** Hold every conversation import; the returned release lets them through. */
export async function holdClosingSave(
  request: APIRequestContext,
): Promise<() => Promise<void>> {
  await request.post(`${FAKE_HOST_URL}/__test__/hold-imports`, {
    data: { hold: true },
  });
  return async () => {
    await request.post(`${FAKE_HOST_URL}/__test__/hold-imports`, {
      data: { hold: false },
    });
  };
}

/**
 * Leave the closing the way a phone evicts a background tab: the document
 * goes with its in-flight requests and none of its handlers run again, then a
 * fresh tab opens on the same origin (same localStorage, same host). The
 * returned page is the one to keep asserting on; the old one is closed.
 *
 * Not `page.reload()`: a reload aborts the held import but still runs its
 * rejection handler on the dying page, a different path (PRODUCT-2040, the
 * reload spec in onboarding-team-roster.spec.ts covers it). This helper models
 * the eviction the resume specs describe.
 */
export async function evictMidClosing(page: Page): Promise<Page> {
  const url = page.url();
  const fresh = await page.context().newPage();
  await seedPage(fresh);
  await page.close();
  await fresh.goto(url);
  return fresh;
}
