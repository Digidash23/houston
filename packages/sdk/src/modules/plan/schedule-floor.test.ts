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
const creator = { createdBy: "u1", viewerId: "u1" };

describe("routineScheduleFloor: the creator's plan decides", () => {
  it("is the Free minimum when the viewer created the routine", () => {
    expect(routineScheduleFloor(free, creator)).toBe(15);
    // The wire pins 15 today; the floor follows whatever the summary carries.
    const thirty = {
      ...free,
      routines: { ...free.routines, minIntervalMinutes: 30 },
    } as unknown as PlanSummary;
    expect(routineScheduleFloor(thirty, creator)).toBe(30);
    const { routines: _omitted, ...bare } = free;
    expect(routineScheduleFloor(bare, creator)).toBe(15);
  });

  it("sets none for someone else's routine, whatever the viewer's plan", () => {
    expect(
      routineScheduleFloor(free, { createdBy: "u2", viewerId: "u1" }),
    ).toBeUndefined();
  });

  it("sets none while either id is unknown", () => {
    for (const viewer of [
      { createdBy: undefined, viewerId: "u1" },
      { createdBy: "u1", viewerId: null },
      { createdBy: "u1", viewerId: undefined },
      { createdBy: "", viewerId: "" },
    ])
      expect(routineScheduleFloor(free, viewer)).toBeUndefined();
  });

  it("sets none on Plus or before the plan loads", () => {
    expect(routineScheduleFloor(plus, creator)).toBeUndefined();
    expect(routineScheduleFloor(undefined, creator)).toBeUndefined();
  });
});
