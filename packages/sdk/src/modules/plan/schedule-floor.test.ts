import type { PlanSummary } from "@houston/wire-types";
import { describe, expect, it } from "vitest";
import { routineScheduleFloor } from "./schedule-floor";

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
