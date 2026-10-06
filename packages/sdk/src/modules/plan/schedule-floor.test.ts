import type { PlanSummary } from "@houston/wire-types";
import { describe, expect, it } from "vitest";
import { routineScheduleFloor, scheduleFloorAllows } from "./schedule-floor";

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

describe("scheduleFloorAllows: the save backstop", () => {
  it("allows anything without a floor", () => {
    expect(scheduleFloorAllows("* * * * *", undefined)).toBe(true);
  });

  it("judges a minute step by its N, as the editor's minimum does", () => {
    // Allowed even where the top of the hour comes sooner (:48 then :00).
    for (const cron of [
      "*/15 * * * *",
      "*/16 * * * *",
      "*/25 * * * *",
      "*/45 * * * *",
      " */59 * * * * ",
    ])
      expect(scheduleFloorAllows(cron, 15), cron).toBe(true);
    for (const cron of ["*/5 * * * *", "*/14 * * * *", "*/1 * * * *"])
      expect(scheduleFloorAllows(cron, 15), cron).toBe(false);
    expect(scheduleFloorAllows("*/20 * * * *", 30)).toBe(false);
  });

  it("judges every other cron by its smallest real gap", () => {
    for (const cron of [
      "* * * * *",
      "0-59/5 * * * *",
      "0,5,10 * * * *",
      "0,5 9 * * 1",
      "55,0 * * * *",
      "*/5 9 * * *",
    ])
      expect(scheduleFloorAllows(cron, 15), cron).toBe(false);
    for (const cron of [
      "0,20,40 * * * *",
      "0,30 * * * *",
      "0 9 * * 1-5",
      "30 8 1 * *",
    ])
      expect(scheduleFloorAllows(cron, 15), cron).toBe(true);
  });
});
