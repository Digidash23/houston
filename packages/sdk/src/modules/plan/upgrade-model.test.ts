import type { PlanSummary } from "@houston/wire-types";
import { describe, expect, it } from "vitest";
import { planUpgradeView } from "./upgrade-model";

const NOW = Date.parse("2026-10-02T00:00:00Z");
const free: PlanSummary = {
  plan: "free",
  announcement: false,
  plus: {
    status: "none",
    manageable: false,
    price: { amount: 1500, currency: "usd", interval: "month" },
  },
};
const withUsage = (percent: number): PlanSummary => ({
  ...free,
  usage: { percent, used: percent, limit: 100 },
});

describe("persistent personal upgrade entry", () => {
  it("waits for a known plan and disappears on Plus", () => {
    expect(planUpgradeView(undefined, NOW)).toBeNull();
    expect(
      planUpgradeView({ ...withUsage(100), plan: "plus" }, NOW),
    ).toBeNull();
  });

  it("stays available below the warning and without usage data", () => {
    for (const plan of [free, withUsage(0), withUsage(79.9)])
      expect(planUpgradeView(plan, NOW)).toEqual({
        status: "free",
        percent: null,
      });
  });

  it("warns at 80 percent and marks the enforced limit at 100", () => {
    expect(planUpgradeView(withUsage(80), NOW)).toEqual({
      status: "nearLimit",
      percent: 80,
    });
    expect(planUpgradeView(withUsage(99.9), NOW)).toEqual({
      status: "nearLimit",
      percent: 99,
    });
    for (const percent of [100, 110])
      expect(planUpgradeView(withUsage(percent), NOW)).toEqual({
        status: "limit",
        percent: 100,
      });
  });

  it("never calls preview usage an enforced limit, then transitions at launch", () => {
    const plan = { ...withUsage(100), limitsStartAt: "2026-10-03T00:00:00Z" };
    expect(planUpgradeView(plan, NOW)).toEqual({
      status: "preview",
      percent: 100,
    });
    expect(planUpgradeView(plan, Date.parse(plan.limitsStartAt))).toEqual({
      status: "limit",
      percent: 100,
    });
  });
});
