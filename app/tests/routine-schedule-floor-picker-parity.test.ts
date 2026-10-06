import { ok } from "node:assert";
import { describe, it } from "node:test";
import type { PlanSummary } from "@houston/engine-adapter";
import { routineScheduleFloor, scheduleFloorAllows } from "@houston/sdk";
import {
  presetToCron,
  type ScheduleOptions,
} from "../../ui/routines/src/schedule-cron-utils.ts";
import { presetAllowed } from "../../ui/routines/src/schedule-floor.ts";
import { intervalToCron } from "../../ui/routines/src/schedule-interval-utils.ts";
import type { SchedulePreset } from "../../ui/routines/src/types.ts";

/**
 * SDK regression: the save backstop (`scheduleFloorAllows`) accepts every cron
 * the schedule picker can emit under a Free creator's floor. The picker lives
 * in `ui/routines`, the backstop in `@houston/sdk`; the app binds both, so the
 * agreement is pinned here.
 */

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
const floor = routineScheduleFloor(free, { createdBy: "u1", viewerId: "u1" });
const OPTIONS: ScheduleOptions = {
  time: "09:30",
  daysOfWeek: [1, 3, 5],
  dayOfMonth: 15,
};
const PRESETS: SchedulePreset[] = [
  "every_30min",
  "hourly",
  "daily",
  "weekly",
  "monthly",
];

describe("picker and save backstop agree for a Free creator", () => {
  it("has the Free floor", () => {
    ok(floor === 15);
  });

  it("accepts every minutes count the picker offers (15 to 120)", () => {
    for (let every = 15; every <= 120; every++) {
      const cron = intervalToCron({ every, unit: "minutes" }, OPTIONS.time);
      ok(scheduleFloorAllows(cron, floor), cron);
    }
  });

  it("accepts every hours, days and months count (1 to 120)", () => {
    for (const unit of ["hours", "days", "months"] as const)
      for (let every = 1; every <= 120; every++) {
        const cron = intervalToCron(
          { every, unit, dayOfMonth: OPTIONS.dayOfMonth },
          OPTIONS.time,
        );
        ok(scheduleFloorAllows(cron, floor), `${unit} ${every}: ${cron}`);
      }
  });

  it("accepts every preset the picker shows", () => {
    for (const preset of PRESETS) {
      ok(presetAllowed(preset, floor), preset);
      const cron = presetToCron(preset, OPTIONS);
      ok(scheduleFloorAllows(cron, floor), `${preset}: ${cron}`);
    }
  });
});
