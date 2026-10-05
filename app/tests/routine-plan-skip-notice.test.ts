import { equal, ok } from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  type TriggerPlanSkipNotice,
  triggerPlanSkipNotice,
} from "@houston/sdk";
import type { PlanSummary, TriggerPlanSkipCode } from "@houston/wire-types";
import en from "../src/locales/en/plan.json" with { type: "json" };
import es from "../src/locales/es/plan.json" with { type: "json" };
import pt from "../src/locales/pt/plan.json" with { type: "json" };

// The routine screen and runs dialog notice for trigger events the Free plan
// refused: the SDK picks the reason and the actions, the view says it in the
// person's language with one button per action.

const resources = { en, es, pt };
type Language = keyof typeof resources;
let render: (
  notice: TriggerPlanSkipNotice,
  language?: Language,
) => Promise<string>;

const free: PlanSummary = {
  plan: "free",
  announcement: false,
  plus: {
    status: "none",
    manageable: false,
    price: { amount: 1500, currency: "usd", interval: "month" },
  },
  routines: {
    paused: false,
    maxActive: 1,
    minIntervalMinutes: 15,
    needsChoice: false,
    limitedCount: 0,
  },
};

function noticeFor(
  code: TriggerPlanSkipCode,
  count: number,
  plan: PlanSummary = free,
): TriggerPlanSkipNotice {
  const notice = triggerPlanSkipNotice(
    {
      routine_id: "r1",
      status: "active",
      plan_skipped: { code, count, last_at: "2026-10-05T19:43:49Z" },
    },
    plan,
  );
  if (!notice) throw new Error(`no notice for ${code}`);
  return notice;
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

before(async () => {
  const React = await import("react");
  Object.assign(globalThis, { React });
  const { renderToStaticMarkup } = await import("react-dom/server");
  const i18next = (await import("i18next")).default;
  const { initReactI18next } = await import("react-i18next");
  await i18next.use(initReactI18next).init({
    lng: "en",
    ns: ["plan"],
    resources: { en: { plan: en }, es: { plan: es }, pt: { plan: pt } },
  });
  const { RoutinePlanSkipNoticeView } = await import(
    "../src/components/agent/routine-plan-skip-notice-view.tsx"
  );
  render = async (notice, language = "en") => {
    await i18next.changeLanguage(language);
    return text(
      renderToStaticMarkup(
        React.createElement(RoutinePlanSkipNoticeView, {
          notice,
          onAction: () => undefined,
        }),
      ),
    );
  };
});

describe("RoutinePlanSkipNoticeView", async () => {
  it("counts the skipped events and names the minimum interval", async () => {
    const html = await render(noticeFor("plan_min_interval", 21));
    ok(html.includes("21 events were skipped in the last 24 hours"), html);
    ok(html.includes("at most once every 15 minutes"), html);
    ok(html.includes(en.upgrade), html);
    ok(!html.includes(en.resume), html);
  });

  it("uses the singular for one event", async () => {
    const html = await render(noticeFor("plan_min_interval", 1));
    ok(html.includes("1 event was skipped"), html);
  });

  it("offers to keep this routine on the routine limit", async () => {
    const html = await render(noticeFor("plan_routine_limit", 3));
    ok(html.includes(en.triggerSkipped.routineLimit.slice(0, 30)), html);
    ok(html.includes(en.chooseRoutine), html);
    ok(html.includes(en.upgrade), html);
  });

  it("offers Resume only while routines are still paused", async () => {
    const paused = await render(
      noticeFor("plan_inactive", 2, {
        ...free,
        routines: { ...(free.routines as never), paused: true },
      }),
    );
    ok(paused.includes(en.triggerSkipped.inactivePaused), paused);
    ok(paused.includes(en.resume), paused);
    const running = await render(noticeFor("plan_inactive", 2));
    ok(running.includes(en.triggerSkipped.inactiveResumed), running);
    equal(running.includes(en.resume), false);
  });

  for (const language of ["es", "pt"] as const) {
    it(`renders authored copy in ${language}`, async () => {
      const html = await render(noticeFor("plan_min_interval", 21), language);
      ok(html.includes("21"), html);
      ok(html.includes(resources[language].upgrade), html);
      equal(html.includes("skipped"), false);
    });
  }
});
