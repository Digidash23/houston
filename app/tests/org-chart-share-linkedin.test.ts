import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  type ShareRunDeps,
  shareLanding,
  shareOrgChart,
} from "../src/components/organization/org-chart-share-run.ts";

const PNG = new File(["png"], "acme-org-chart.png", { type: "image/png" });
const PAGE = "https://agents.gethouston.ai/o/AbCdEfGhIjKlMnOpQrSt_-";

/** Desktop-shaped deps that record every call. */
function harness(overrides: Partial<ShareRunDeps> = {}) {
  const calls: string[] = [];
  const reports: string[] = [];
  const deps: ShareRunDeps = {
    post: (link) => `Hello ${link}`,
    png: Promise.resolve(PNG),
    ready: PNG,
    phone: false,
    sheet: undefined,
    copyImage: async () => {
      calls.push("copy");
    },
    open: async (url) => {
      calls.push(`open:${new URL(url).host}`);
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
  it("opens the composer in the click's own tick, posting the page, and does nothing else", async () => {
    const { deps, calls, reports } = harness();
    const running = shareOrgChart(deps, PAGE);
    // Synchronously: the open is the only thing the click does.
    deepStrictEqual(calls, ["open:www.linkedin.com"]);
    const outcome = await running;
    strictEqual(outcome.kind === "linkedin" && outcome.image, "linked");
    strictEqual(
      outcome.kind === "linkedin" &&
        new URL(outcome.url).searchParams.get("text"),
      `Hello ${PAGE}`,
    );
    deepStrictEqual(calls, ["open:www.linkedin.com"]);
    deepStrictEqual(reports, []);
  });

  it("goes without the clipboard even when the drawing is still under way", async () => {
    const { deps, calls } = harness({
      png: new Promise<File>(() => {}),
      ready: null,
    });
    const outcome = await shareOrgChart(deps, PAGE);
    strictEqual(outcome.kind === "linkedin" && outcome.opened, true);
    deepStrictEqual(calls, ["open:www.linkedin.com"]);
  });

  it("is tracked as a link share, and a blocked tab says so with the link", async () => {
    const opened = await shareOrgChart(harness().deps, PAGE);
    deepStrictEqual(shareLanding(opened, false), {
      channel: "linkedin_link",
      line: null,
      blocked: null,
    });
    const blocked = await shareOrgChart(
      harness({ open: async () => false }).deps,
      PAGE,
    );
    deepStrictEqual(shareLanding(blocked, false), {
      channel: null,
      line: "blocked",
      blocked: "linkedin_link",
    });
    // The desktop shell explained its own refusal.
    deepStrictEqual(shareLanding(blocked, true), {
      channel: null,
      line: null,
      blocked: null,
    });
  });

  it("leaves the phone's share sheet to the sheet", async () => {
    const { deps, calls } = harness({
      phone: true,
      sheet: { canShare: () => true, share: async () => {} },
    });
    deepStrictEqual(await shareOrgChart(deps, PAGE), { kind: "native" });
    deepStrictEqual(calls, []);
  });
});
