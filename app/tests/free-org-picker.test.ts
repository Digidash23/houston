import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { before, describe, it } from "node:test";
import type { BillingChoice } from "@houston/engine-adapter";
import { choiceNotice } from "@houston/sdk";
import { JSDOM } from "jsdom";
import type { ReactElement } from "react";
import plan from "../src/locales/en/plan.json" with { type: "json" };
import planEs from "../src/locales/es/plan.json" with { type: "json" };
import planPt from "../src/locales/pt/plan.json" with { type: "json" };

let h: typeof import("react").createElement;
let render: (element: ReactElement) => string;
let steps: typeof import("../src/components/shell/free-org-picker-steps.tsx");
let copy: typeof import("../src/components/shell/billing-change-copy.ts");
let i18next: typeof import("i18next").default;

before(async () => {
  const React = await import("react");
  Object.assign(globalThis, { React });
  h = React.createElement;
  render = (await import("react-dom/server")).renderToStaticMarkup;
  i18next = (await import("i18next")).default;
  const { initReactI18next } = await import("react-i18next");
  await i18next.use(initReactI18next).init({
    lng: "en",
    ns: ["plan"],
    defaultNS: "plan",
    resources: { en: { plan }, es: { plan: planEs } },
  });
  steps = await import("../src/components/shell/free-org-picker-steps.tsx");
  copy = await import("../src/components/shell/billing-change-copy.ts");
});

const org = (slug: string, name: string, patch = {}) => ({
  slug,
  name,
  personal: false,
  memberCount: 1,
  messages30d: 0,
  lastActiveOn: null,
  monthlyTotalCents: null,
  seatGraceEndsOn: null,
  lockAt: null,
  ...patch,
});

const CHOICE: BillingChoice = {
  needed: true,
  payer: "plus",
  state: "pending",
  provisional: false,
  cutoverAt: "2026-10-23T05:00:00Z",
  changeableUntil: null,
  noticeDismissed: false,
  freeOrgSlug: null,
  paidOrgSlug: null,
  orgs: [
    org("3333333333333333", "daniel", {
      personal: true,
      messages30d: 12,
      monthlyTotalCents: 1500,
    }),
    org("2222222222222222", "Innova", {
      memberCount: 4,
      messages30d: 210,
      monthlyTotalCents: 6000,
      seatGraceEndsOn: "2026-11-22",
    }),
    org("1111111111111111", "La Fila", {
      messages30d: 396,
      monthlyTotalCents: 1500,
    }),
  ],
};

const doc = (element: ReactElement) =>
  new JSDOM(render(element)).window.document;
const title = (text: string) => h("h2", null, text);
const noop = () => undefined;

describe("the free-org picker", () => {
  it("lists the busiest org first, tagged and preselected, with its activity", () => {
    const page = doc(
      h(steps.FreeStep, {
        choice: CHOICE,
        selected: "1111111111111111",
        onSelect: noop,
        busy: false,
        title,
        onConfirm: noop,
      }),
    );
    const rows = [...page.querySelectorAll("label")].map((row) =>
      row.textContent?.trim(),
    );
    deepStrictEqual(rows, [
      "LFLa FilaMost active1 member · 396 messages in the last 30 days",
      "INInnova4 members · 210 messages in the last 30 days",
      "PEPersonal1 member · 12 messages in the last 30 days",
    ]);
    const checked = page.querySelector<HTMLInputElement>("input:checked");
    strictEqual(checked?.value, "1111111111111111");
    ok(
      page.body.textContent?.includes("You can change this until October 23."),
    );
    strictEqual(page.querySelector("button")?.textContent, "Keep La Fila free");
  });

  it("prices the payer step and shows the free pick as a disabled row", () => {
    const page = doc(
      h(steps.PaidStep, {
        choice: CHOICE,
        freeSlug: "1111111111111111",
        selected: "2222222222222222",
        onSelect: noop,
        busy: false,
        title,
        onBack: noop,
        onConfirm: noop,
      }),
    );
    const text = page.body.textContent ?? "";
    ok(text.includes("Step 2 of 2"));
    ok(text.includes("4 members · $15 each$60per month"));
    ok(text.includes("La FilaStays freeYour free organization"));
    ok(
      text.includes(
        "Your price stays $15 a month until November 22, then it's $60 a month.",
      ),
    );
    strictEqual(page.querySelectorAll("label").length, 2);
    const buttons = [...page.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    deepStrictEqual(buttons, ["Back", "Use my plan for Innova"]);
  });
});

function noticeText(choice: BillingChoice) {
  const notice = choiceNotice(choice, {
    now: Date.parse("2026-10-20T17:00:00.000Z"),
    locale: i18next.language,
  });
  if (
    notice.kind !== "pick" &&
    notice.kind !== "single_org" &&
    notice.kind !== "member"
  )
    return notice.kind;
  let out = "";
  const Probe = () => {
    out = copy.useNoticeBody(notice, choice);
    return null;
  };
  render(h(Probe));
  return out;
}

const SINGLE = {
  ...CHOICE,
  needed: false,
  payer: null,
  orgs: [{ ...CHOICE.orgs[2] }],
};

describe("the announcement copy", () => {
  it("asks an owner to choose, with the date and the price", () => {
    strictEqual(
      noticeText({ ...CHOICE, payer: null }),
      "From Friday, October 23, one of your organizations stays free. The others are $15 per member a month.",
    );
  });

  it("tells a payer the subscription moves to the org they pick", () => {
    strictEqual(
      noticeText(CHOICE),
      "From Friday, October 23, one of your organizations stays free. The others are $15 per member a month. Your subscription moves to the organization you pick.",
    );
  });

  it("names the one org that stays free, or that the subscription pays for", () => {
    strictEqual(
      noticeText(SINGLE),
      "From Friday, October 23, La Fila stays free. Upgrade anytime for $15 per member a month.",
    );
    strictEqual(
      noticeText({ ...SINGLE, payer: "plus" }),
      "From Friday, October 23, your subscription pays for La Fila.",
    );
  });

  it("tells a member in someone else's org that the owner chooses", () => {
    strictEqual(
      noticeText({ ...SINGLE, orgs: [] }),
      "From Friday, October 23, plans work per organization. Your organization's owner chooses the plan.",
    );
  });

  it("says nothing once the pick is stored", () => {
    strictEqual(
      noticeText({ ...CHOICE, freeOrgSlug: "1111111111111111" }),
      "picked",
    );
  });

  it("names the date in the reader's language", async () => {
    await i18next.changeLanguage("es");
    try {
      strictEqual(
        noticeText({ ...CHOICE, payer: null }),
        "Desde el viernes, 23 de octubre, una de tus organizaciones sigue gratis. Las demás cuestan 15\u00a0US$ por miembro al mes.",
      );
    } finally {
      await i18next.changeLanguage("en");
    }
  });

  it("never states the free org's weekly message count, in any language", () => {
    for (const locale of [plan, planEs, planPt]) {
      const text = JSON.stringify(locale.choice);
      ok(!/\{\{limit\}\}|\b40\b/.test(text), text);
    }
  });
});
