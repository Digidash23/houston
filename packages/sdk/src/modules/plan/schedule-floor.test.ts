import type { PlanSummary } from "@houston/wire-types";
import { describe, expect, it } from "vitest";
import { routineScheduleFloor, scheduleFloorRule } from "./schedule-floor";

const free = {
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
} satisfies PlanSummary;
const plus: PlanSummary = { ...free, plan: "plus" };

/**
 * Every save re-stamps the routine's creator to the editor, so the floor is
 * the EDITOR's plan: the routine's creator never enters the decision.
 */
describe("routineScheduleFloor: the editor's own plan decides", () => {
  it("a Free viewer editing a Plus creator's routine gets the floor", () => {
    expect(routineScheduleFloor(free)).toBe(15);
  });

  it("a Plus viewer editing a Free creator's routine gets none", () => {
    expect(routineScheduleFloor(plus)).toBeUndefined();
  });

  it("follows the minimum the summary carries", () => {
    const thirty = {
      ...free,
      routines: { ...free.routines, minIntervalMinutes: 30 },
    } as unknown as PlanSummary;
    expect(routineScheduleFloor(thirty)).toBe(30);
    const { routines: _omitted, ...bare } = free;
    expect(routineScheduleFloor(bare)).toBe(15);
  });

  it("sets none before the plan loads", () => {
    expect(routineScheduleFloor(undefined)).toBeUndefined();
  });
});

describe("scheduleFloorRule: what an editor binds", () => {
  it("judges a cron by its real gap, as the host's gate does", () => {
    const rule = scheduleFloorRule(15);
    expect(rule.minutes).toBe(15);
    expect(rule.allows("*/15 * * * *")).toBe(true);
    expect(rule.allows("*/20 * * * *")).toBe(true);
    // :48 then :00: a 12-minute gap, whatever the step says.
    expect(rule.allows("*/16 * * * *")).toBe(false);
    expect(rule.allows("*/5 * * * *")).toBe(false);
    expect(rule.allows("0 9 * * *")).toBe(true);
  });

  it("judges an @every interval by its step: it runs exactly that far apart", () => {
    const rule = scheduleFloorRule(15);
    expect(rule.allows("@every 16m")).toBe(true);
    expect(rule.allows("@every 15m")).toBe(true);
    expect(rule.allows("@every 5h")).toBe(true);
    expect(rule.allows("@every 14m")).toBe(false);
    expect(rule.allows("@every 7m")).toBe(false);
  });
});
