import { ok, strictEqual } from "node:assert";
import { before, describe, it } from "node:test";
import type { OrgMember } from "@houston/engine-adapter";
import i18next from "i18next";
import {
  isShareCancel,
  linkedInShareUrl,
  SHARE_CARD_CAPS,
  SHARE_SITE_LINK,
  shareFileName,
  sharePostText,
  shareTitle,
} from "../src/components/organization/org-chart-share-model.ts";
import { buildOrgTree } from "../src/components/organization/org-chart-tree.ts";
import enTeams from "../src/locales/en/teams.json" with { type: "json" };
import esTeams from "../src/locales/es/teams.json" with { type: "json" };
import ptTeams from "../src/locales/pt/teams.json" with { type: "json" };

const i18n = i18next.createInstance();

before(async () => {
  await i18n.init({
    lng: "en",
    ns: ["teams"],
    defaultNS: "teams",
    interpolation: { escapeValue: false },
    resources: {
      en: { teams: enTeams },
      es: { teams: esTeams },
      pt: { teams: ptTeams },
    },
  });
});

const members: OrgMember[] = [
  { userId: "o", role: "owner", displayName: "Olga Owner" },
  { userId: "u", role: "user", displayName: "Uma User" },
];
const agent = (id: string) => ({
  id,
  name: id,
  folderPath: id,
  configId: "c",
  createdAt: "2026-01-01",
});
const tree = (personal: boolean, name = "Acme & Co") =>
  buildOrgTree(
    { agents: [agent("a"), agent("b")], members, name, personal },
    SHARE_CARD_CAPS,
  );

describe("sharePostText", () => {
  it("says it is the company's AI Employees, in Houston, ending on gethouston.ai", () => {
    strictEqual(
      sharePostText(
        i18n.getFixedT("en", "teams"),
        tree(false),
        SHARE_SITE_LINK,
      ),
      "This is my organization. These are all the AI Employees at Acme & Co, working in Houston.\n\ngethouston.ai",
    );
  });

  it("speaks of the person's own AI Employees in a personal space", () => {
    const text = sharePostText(
      i18n.getFixedT("en", "teams"),
      tree(true),
      SHARE_SITE_LINK,
    );
    strictEqual(
      text,
      "These are all my AI Employees, working in Houston.\n\ngethouston.ai",
    );
  });

  it("ends on the chart's page when it has one", () => {
    const page = "https://agents.gethouston.ai/o/AbCdEfGhIjKlMnOpQrSt_-";
    strictEqual(
      sharePostText(i18n.getFixedT("en", "teams"), tree(true), page),
      `These are all my AI Employees, working in Houston.\n\n${page}`,
    );
  });

  it("ships every language with no em dash, no hashtag, and the link last", () => {
    for (const lng of ["en", "es", "pt"]) {
      for (const subject of [tree(false), tree(true)]) {
        const text = sharePostText(
          i18n.getFixedT(lng, "teams"),
          subject,
          SHARE_SITE_LINK,
        );
        ok(!text.includes("—"), `${lng}: ${text}`);
        ok(!text.includes("{{"), `${lng}: ${text}`);
        ok(!text.includes("#"), `${lng}: ${text}`);
        ok(text.includes("Houston"), `${lng}: ${text}`);
        ok(text.endsWith("gethouston.ai"), `${lng}: ${text}`);
      }
      ok(
        sharePostText(
          i18n.getFixedT(lng, "teams"),
          tree(false),
          SHARE_SITE_LINK,
        ).includes("Acme & Co"),
        lng,
      );
    }
  });
});

describe("shareTitle", () => {
  it("is the space's name, or the personal space's person", () => {
    strictEqual(shareTitle(tree(false)), "Acme & Co");
    strictEqual(shareTitle(tree(true)), "Olga Owner");
  });
});

describe("shareFileName", () => {
  it("slugs the company into a safe PNG name", () => {
    strictEqual(shareFileName("Acme & Co."), "acme-co-org-chart.png");
    strictEqual(
      shareFileName("Café Niño / Ventas"),
      "cafe-nino-ventas-org-chart.png",
    );
    strictEqual(shareFileName("  ../../etc  "), "etc-org-chart.png");
    strictEqual(shareFileName("東京 Labs"), "東京-labs-org-chart.png");
  });

  it("falls back when nothing usable is left, and caps a long name", () => {
    strictEqual(shareFileName("***"), "org-chart.png");
    strictEqual(shareFileName(""), "org-chart.png");
    const long = shareFileName("a".repeat(59) + " b".repeat(40));
    ok(long.length <= 60 + "-org-chart.png".length, long);
    ok(!long.includes("--"), long);
  });
});

describe("linkedInShareUrl", () => {
  it("prefills LinkedIn's composer with the encoded post", () => {
    const url = new URL(linkedInShareUrl("Hi & bye\n#AI"));
    strictEqual(url.origin, "https://www.linkedin.com");
    strictEqual(url.searchParams.get("shareActive"), "true");
    strictEqual(url.searchParams.get("text"), "Hi & bye\n#AI");
  });
});

describe("isShareCancel", () => {
  it("treats only an AbortError as the person closing the sheet", () => {
    strictEqual(isShareCancel(new DOMException("x", "AbortError")), true);
    strictEqual(isShareCancel(new DOMException("x", "NotAllowedError")), false);
    strictEqual(isShareCancel(new Error("boom")), false);
    strictEqual(isShareCancel(null), false);
  });
});
