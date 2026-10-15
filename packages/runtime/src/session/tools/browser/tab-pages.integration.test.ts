import { createServer } from "node:http";
import { afterAll, describe, expect, test } from "vitest";
import {
  agentWorkspace,
  browserAvailable,
  fixturePool,
  listen,
  SITE_HOST,
} from "./browser.test-support";
import { browserStatePath } from "./state-store";
import { MAX_TAB_PAGES, maxTabPages, TURN_MAX_TAB_PAGES } from "./tab-pages";

const available = await browserAvailable();

const site = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  const step = Number(/^\/chain\/(\d+)$/.exec(req.url ?? "")?.[1] ?? -1);
  res.end(
    req.url === "/many"
      ? // Windows opened with no click at all: popup blocking stops them.
        `<title>Many</title><script>for (let i = 0; i < 6; i++) setTimeout(() => window.open("/p" + i), 20 * i)</script>`
      : step >= 0
        ? // Each popup's button opens the next: a chain of openers.
          `<title>Chain ${step}</title><button onclick="window.open('/chain/${step + 1}')">Next</button>`
        : "<title>Popup</title><h1>Popup</h1>",
  );
});
const origin = available ? `http://${SITE_HOST}:${await listen(site)}` : "";
const pool = fixturePool({ maxPages: TURN_MAX_TAB_PAGES });

afterAll(async () => {
  await pool.shutdown();
  site.close();
});

test("a pooled turn keeps 3 pages per chat; everywhere else keeps 8", () => {
  expect(maxTabPages({ HOUSTON_MODE: "turn" })).toBe(3);
  expect(maxTabPages({ HOUSTON_MODE: "server" })).toBe(MAX_TAB_PAGES);
  expect(maxTabPages({})).toBe(8);
});

describe.skipIf(!available)("the page cap in a real Chromium", () => {
  const openTab = (path: string) =>
    pool.run(
      `k${path}`,
      browserStatePath(agentWorkspace("browser-pages-")),
      async (t) => {
        await t.page.goto(`${origin}${path}`);
        return t;
      },
    );

  test("windows a page opens with no click never pass the cap", async () => {
    // Full Chrome's popup blocker stops them outright; the headless shell
    // has no popup blocker, so there the cap is what holds.
    const tab = await openTab("/many");
    await new Promise((resolve) => setTimeout(resolve, 600));
    await expect
      .poll(() => tab.context.pages().filter((p) => !p.isClosed()).length, {
        timeout: 5_000,
      })
      .toBeLessThanOrEqual(TURN_MAX_TAB_PAGES);
    expect(tab.page.isClosed()).toBe(false);
  });

  test("a click-opened popup chain is capped: only the newest page and its direct opener are kept", async () => {
    const tab = await openTab("/chain/0");
    for (let step = 1; step <= 5; step++) {
      // A real click (as the model's is): popup blocking lets it through.
      await tab.page.getByRole("button", { name: "Next" }).click();
      await expect
        .poll(() => tab.page.url(), { timeout: 5_000 })
        .toMatch(new RegExp(`/chain/${step}$`));
    }
    await expect
      .poll(() => tab.context.pages().filter((p) => !p.isClosed()).length, {
        timeout: 5_000,
      })
      .toBeLessThanOrEqual(TURN_MAX_TAB_PAGES);
    expect(tab.page.isClosed()).toBe(false);
    const opener = await tab.page.opener();
    expect(opener?.url()).toMatch(/\/chain\/4$/);
    expect(opener?.isClosed()).toBe(false);
  });
});
