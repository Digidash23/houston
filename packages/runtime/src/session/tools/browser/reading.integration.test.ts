import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, test } from "vitest";
import type { BrowserParams } from "./actions";
import {
  agentWorkspace,
  browserAvailable,
  fixturePool,
  listen,
  ref,
  SITE_HOST,
  tool,
} from "./browser.test-support";
import { pagesSite } from "./browser-pages.test-support";
import type { BrowserPool } from "./pool";
import { browserStatePath } from "./state-store";
import { makeBrowserTool } from "./tool";
import { UNTRUSTED_OPEN } from "./untrusted";

const available = await browserAvailable();
const server = pagesSite();
const origin = available ? `http://${SITE_HOST}:${await listen(server)}` : "";

const pools: BrowserPool[] = [];
const newPool = () => {
  const pool = fixturePool();
  pools.push(pool);
  return pool;
};

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.shutdown()));
  server.closeAllConnections();
  server.close();
});

describe.skipIf(!available)(
  "reading pages in a real Chromium (skips when no Chromium-family browser is installed)",
  { timeout: 30_000 },
  () => {
    test("text reads the main content, fenced, never a password", async () => {
      const browse = tool(agentWorkspace(), newPool());
      const page = await browse({ action: "open", url: `${origin}/article` });
      await browse({
        action: "fill",
        ref: ref(page.text, "textbox", "Secret"),
        text: "Hunter22pw",
      });
      const read = await browse({ action: "text" });
      expect(read.details.ok).toBe(true);
      expect(read.text.startsWith(UNTRUSTED_OPEN)).toBe(true);
      expect(read.text).toContain("Page: Story");
      expect(read.text).toContain("The story\nFirst para with spaces\nSecret");
      expect(read.text).not.toContain("Menu entries");
      expect(read.text).not.toContain("Hunter22pw");
    });

    test("elements a click revealed are marked new; a new document is not compared", async () => {
      const browse = tool(agentWorkspace(), newPool());
      const page = await browse({ action: "open", url: `${origin}/reveal` });
      expect(page.text).not.toContain("[new]");
      const shown = await browse({
        action: "click",
        ref: ref(page.text, "button", "Show more"),
      });
      expect(shown.text).toContain("2 new since the last look");
      expect(shown.text).toMatch(/button "Advanced" \[ref=s\d+e\d+\] \[new\]/);
      expect(shown.text).not.toMatch(/"Show more"[^\n]*\[new\]/);
      // The refs printed with [new] are the latest ones: they click.
      expect(
        (
          await browse({
            action: "click",
            ref: ref(shown.text, "button", "Advanced"),
          })
        ).details.ok,
      ).toBe(true);
      const reopened = await browse({
        action: "open",
        url: `${origin}/reveal`,
      });
      expect(reopened.text).not.toContain("[new]");
    });

    test("query and interactive narrow a long page; links come redacted", async () => {
      const browse = tool(agentWorkspace(), newPool());
      const full = await browse({ action: "open", url: `${origin}/many` });
      expect(full.text).not.toContain("/url:");
      const found = await browse({
        action: "snapshot",
        query: "gadget",
        links: true,
      });
      expect(found.text).toContain('4 lines match "gadget"');
      expect(found.text).not.toContain('"Item 3"');
      expect(found.text).toContain(`/url: ${origin}/item/17?session=[hidden]`);
      // A filtered look is still the latest: its refs click.
      const clicked = await browse({
        action: "click",
        ref: ref(found.text, "link", "Item 7 gadget"),
      });
      expect(clicked.text).toContain("Address: ");
      expect(clicked.details.ok).toBe(true);
      const controls = await browse({ action: "snapshot", interactive: true });
      expect(controls.text).not.toContain("paragraph");
    });

    test("a labeled screenshot names clickable refs and leaves the page clean", async () => {
      const ws = agentWorkspace();
      const pool = newPool();
      const browse = tool(ws, pool);
      await browse({ action: "open", url: `${origin}/confirm` });
      const shot = await execute(ws, pool, {
        action: "screenshot",
        labels: true,
      });
      expect(shot.image).toBe(true);
      const label = /(s\d+e\d+) button "Delete"/.exec(shot.text)?.[1];
      expect(label).toBeDefined();
      expect(shot.text).toContain("controls are labeled");
      const overlays = await pool.run(
        `${ws}\0default`,
        browserStatePath(ws),
        (tab) =>
          tab.page.evaluate(
            () => document.querySelectorAll('[id^="houston-labels-"]').length,
          ),
      );
      expect(overlays).toBe(0);
      const clicked = await browse({ action: "click", ref: label ?? "" });
      expect(clicked.text).toContain("A dialog is open (confirm)");
    });
  },
);

/** The tool's raw result: its text, and whether it carried an image. */
async function execute(ws: string, pool: BrowserPool, params: BrowserParams) {
  const browser = makeBrowserTool({ workspaceDir: ws, pool, liveView: false });
  // SAFETY: the browser tool never reads its ExtensionContext.
  const result = await browser.execute(
    "t",
    params,
    undefined,
    undefined,
    {} as ExtensionToolContext,
  );
  return {
    text: result.content.map((c) => (c.type === "text" ? c.text : "")).join(""),
    image: result.content.some((c) => c.type === "image"),
  };
}
