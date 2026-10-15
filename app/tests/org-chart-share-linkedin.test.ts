import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { OrgChartShareResult } from "@houston/engine-adapter";
import {
  type ShareRunDeps,
  shareLanding,
  shareOrgChart,
} from "../src/components/organization/org-chart-share-run.ts";
import type { ReservedTab } from "../src/lib/browser-tab.ts";

const PNG = new File(["png"], "acme-org-chart.png", { type: "image/png" });
const PAGE = "https://agents.gethouston.ai/o/AbCdEfGhIjKlMnOpQrSt_-";
const PUBLISHED: OrgChartShareResult = {
  kind: "published",
  id: "AbCdEfGhIjKlMnOpQrSt_-",
  pageUrl: PAGE,
  imageUrl: "https://gateway.gethouston.ai/x",
};

/** The text of the composer link a call opened. */
const postOf = (url: string) => new URL(url).searchParams.get("text");

/**
 * Deps that record every call, web-shaped (a tab is claimed in the click)
 * unless overridden. The clipboard behaves like a browser's: the write
 * lands once the image promise it was handed resolves, and fails when it
 * rejects.
 */
function harness(overrides: Partial<ShareRunDeps> = {}) {
  const calls: string[] = [];
  const reports: string[] = [];
  const tab: ReservedTab = {
    navigate: (url) => {
      calls.push(`navigate:${postOf(url)}`);
      return true;
    },
    discard: () => calls.push("discard"),
  };
  const deps: ShareRunDeps = {
    post: (link) => `Hello ${link}`,
    png: Promise.resolve(PNG),
    ready: PNG,
    phone: false,
    sheet: undefined,
    copyImage: (png) => {
      calls.push("copy");
      return png.then(() => {
        calls.push("copied");
      });
    },
    publish: async (file) => {
      calls.push(`publish:${file.name}`);
      return PUBLISHED;
    },
    reserveTab: () => {
      calls.push("tab");
      return tab;
    },
    wait: () => new Promise(() => {}),
    open: async (url) => {
      calls.push(`open:${postOf(url)}`);
      return true;
    },
    save: async (file) => {
      calls.push(`save:${file.name}`);
      return true;
    },
    report: (command) => reports.push(command),
    ...overrides,
  };
  return { deps, calls, reports };
}

describe("Share on LinkedIn with the chart's page", () => {
  it("claims the tab in the click, then points it at a post ending on the page", async () => {
    const { deps, calls, reports } = harness();
    const running = shareOrgChart(deps);
    deepStrictEqual(calls, ["copy", "tab"]);
    const outcome = await running;
    deepStrictEqual(calls, [
      "copy",
      "tab",
      "publish:acme-org-chart.png",
      `navigate:Hello ${PAGE}`,
    ]);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "linked");
    strictEqual(outcome.kind === "linkedin" && outcome.opened, true);
    strictEqual(
      outcome.kind === "linkedin" && postOf(outcome.url),
      `Hello ${PAGE}`,
    );
    deepStrictEqual(reports, []);
  });

  it("writes nothing to the clipboard when the post links the image", async () => {
    const { deps, calls } = harness();
    await shareOrgChart(deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    strictEqual(calls.includes("copied"), false);
  });

  it("opens the composer after the upload where no tab was claimed (the desktop shell)", async () => {
    const { deps, calls } = harness({ reserveTab: () => null });
    const outcome = await shareOrgChart(deps);
    deepStrictEqual(calls, [
      "copy",
      "publish:acme-org-chart.png",
      `open:Hello ${PAGE}`,
    ]);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "linked");
  });

  it("opens normally when the person closed the claimed tab", async () => {
    const { deps, calls } = harness();
    deps.reserveTab = () => ({ navigate: () => false, discard: () => {} });
    const outcome = await shareOrgChart(deps);
    strictEqual(calls.at(-1), `open:Hello ${PAGE}`);
    strictEqual(outcome.kind === "linkedin" && outcome.opened, true);
  });
});

describe("Share on LinkedIn without the page", () => {
  it("goes back to gethouston.ai and the clipboard, quietly, when the deployment keeps no pages", async () => {
    const { deps, calls, reports } = harness({
      publish: async () => ({ kind: "refused", code: "unavailable" }),
    });
    const outcome = await shareOrgChart(deps);
    deepStrictEqual(calls, [
      "copy",
      "tab",
      "navigate:Hello gethouston.ai",
      "copied",
    ]);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "copied");
    deepStrictEqual(reports, []);
  });

  it("reports a refusal of what the client sent, and still shares", async () => {
    const { deps, reports } = harness({
      publish: async () => ({ kind: "refused", code: "too_large" }),
    });
    const outcome = await shareOrgChart(deps);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "copied");
    deepStrictEqual(reports, ["org_chart_share_publish"]);
  });

  it("reports an upload that failed, and still shares", async () => {
    const { deps, reports } = harness({
      publish: () => Promise.reject(new Error("500")),
    });
    const outcome = await shareOrgChart(deps);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "copied");
    deepStrictEqual(reports, ["org_chart_share_publish"]);
  });

  it("stops waiting on a slow upload, without a report", async () => {
    const { deps, calls, reports } = harness({
      publish: () => new Promise(() => {}),
      wait: async () => {},
    });
    const outcome = await shareOrgChart(deps);
    strictEqual(calls.includes("navigate:Hello gethouston.ai"), true);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "copied");
    deepStrictEqual(reports, []);
  });

  it("uploads nothing when the drawing failed", async () => {
    const failed = Promise.reject(new Error("no canvas"));
    failed.catch(() => {});
    const { deps, calls, reports } = harness({ png: failed, ready: null });
    const outcome = await shareOrgChart(deps);
    deepStrictEqual(calls, ["copy", "tab", "navigate:Hello gethouston.ai"]);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "none");
    deepStrictEqual(reports, []);
  });
});

describe("shareLanding for a linked post", () => {
  it("tracks the link and says nothing about pasting", () => {
    deepStrictEqual(
      shareLanding(
        { kind: "linkedin", url: "u", opened: true, image: "linked" },
        false,
      ),
      { channel: "linkedin_link", line: null, blocked: null },
    );
  });

  it("offers the composer's link when the browser blocked it", () => {
    deepStrictEqual(
      shareLanding(
        { kind: "linkedin", url: "u", opened: false, image: "linked" },
        false,
      ),
      { channel: null, line: "blocked", blocked: "linkedin_link" },
    );
  });
});
