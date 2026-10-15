import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import i18next from "i18next";
import { copyImageWith } from "../src/components/organization/org-chart-share-copy.ts";
import { shareTabReserver } from "../src/components/organization/org-chart-share-tab.ts";
import type { ReservedTab } from "../src/lib/browser-tab.ts";
import enTeams from "../src/locales/en/teams.json" with { type: "json" };

const i18n = i18next.createInstance();

before(async () => {
  await i18n.init({
    lng: "en",
    ns: ["teams"],
    defaultNS: "teams",
    resources: { en: { teams: enTeams } },
  });
});

const source = (file: string) =>
  readFileSync(
    join(import.meta.dirname, "../src/components/organization", file),
    "utf8",
  ).replace(/\s+/g, " ");

function fakeTab(hold: (line: string) => void): ReservedTab {
  return { navigate: () => true, discard: () => {}, hold };
}

describe("the share's claimed tab", () => {
  it("holds the translated line while the upload runs", () => {
    const held: string[] = [];
    const reserve = shareTabReserver(i18n.t("orgChart.share.preparingTab"), {
      tauri: false,
      reserve: () => fakeTab((line) => held.push(line)),
      report: () => {},
    });
    ok(reserve());
    deepStrictEqual(held, ["Preparing your LinkedIn post..."]);
  });

  it("is what the dialog's deps claim, with the line the dialog translated", () => {
    ok(
      source("use-org-chart-share.ts").includes(
        '(next) => pending(next), t("orgChart.share.preparingTab"), );',
      ),
      "browserShareDeps must get the translated holding line",
    );
    ok(
      source("org-chart-share-browser.ts").includes(
        "reserveTab: shareTabReserver(holding, {",
      ),
      "browserShareDeps must claim its tab through shareTabReserver",
    );
  });

  it("claims nothing in the desktop shell", () => {
    let asked = false;
    const reserve = shareTabReserver("line", {
      tauri: true,
      reserve: () => {
        asked = true;
        return null;
      },
      report: () => {},
    });
    strictEqual(reserve(), null);
    strictEqual(asked, false);
  });

  it("reports a line it could not write and keeps the tab", () => {
    const reports: string[] = [];
    const tab = fakeTab(() => {
      throw new Error("no body");
    });
    const reserve = shareTabReserver("line", {
      tauri: false,
      reserve: () => tab,
      report: (command) => reports.push(command),
    });
    strictEqual(reserve(), tab);
    deepStrictEqual(reports, ["org_chart_share_holding"]);
  });
});

describe("Copy image", () => {
  const PNG = Promise.resolve(new File(["png"], "a.png"));

  it("turns a write that throws before it starts into a rejection", async () => {
    const refused = new TypeError("ClipboardItem: unsupported type");
    const reports: string[] = [];
    const returned = copyImageWith(
      () => {
        throw refused;
      },
      (command) => reports.push(command),
      PNG,
    );
    await rejects(returned, (error) => error === refused);
    deepStrictEqual(reports, []);
  });

  it("is true once written, and quiet on the browser's own refusal", async () => {
    const reports: string[] = [];
    const report = (command: string) => reports.push(command);
    strictEqual(await copyImageWith(async () => {}, report, PNG), true);
    const notAllowed = new DOMException("denied", "NotAllowedError");
    strictEqual(
      await copyImageWith(() => Promise.reject(notAllowed), report, PNG),
      false,
    );
    deepStrictEqual(reports, []);
    strictEqual(
      await copyImageWith(() => Promise.reject(new Error("x")), report, PNG),
      false,
    );
    deepStrictEqual(reports, ["org_chart_share_copy_image"]);
  });
});
