import { deepStrictEqual, ok } from "node:assert";
import { describe, it } from "node:test";
import type { PlanSummary } from "@houston/engine-adapter";
import {
  routineScheduleFloor,
  scheduleFloorAllows,
  scheduleFloorRule,
} from "@houston/sdk";
import {
  presetToCron,
  type ScheduleOptions,
} from "../../ui/routines/src/schedule-cron-utils.ts";
import {
  floorMinuteCounts,
  presetAllowed,
} from "../../ui/routines/src/schedule-floor.ts";
import { intervalToCron } from "../../ui/routines/src/schedule-interval-utils.ts";
import type { SchedulePreset } from "../../ui/routines/src/types.ts";

/**
 * SDK regression: the schedule picker offers exactly what the save backstop
 * and the host's gate accept under a Free saver's floor. The picker lives in
 * `ui/routines` and only asks the rule it is handed; the app hands it the
 * SDK's (`scheduleFloorRule`), the same `scheduleFloorAllows` the host's
 * routine-write gate runs, so the agreement is pinned here.
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
const minutes = routineScheduleFloor(free);
const rule = scheduleFloorRule(minutes ?? 0);
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

describe("picker and save backstop agree for a Free saver", () => {
  it("has the Free floor", () => {
    ok(minutes === 15);
  });

  it("offers only the minute counts whose real gap reaches the floor", () => {
    // A step restarts at the top of the hour: */16 fires :48 then :00.
    const offered = floorMinuteCounts(rule);
    deepStrictEqual(
      offered,
      [
        15, 20, 21, 22, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
        44, 45,
      ],
    );
    for (let every = 1; every <= 59; every++) {
      const cron = intervalToCron({ every, unit: "minutes" }, OPTIONS.time);
      ok(offered.includes(every) === scheduleFloorAllows(cron, minutes), cron);
    }
  });

  it("accepts every hours, days and months count (1 to 120)", () => {
    for (const unit of ["hours", "days", "months"] as const)
      for (let every = 1; every <= 120; every++) {
        const cron = intervalToCron(
          { every, unit, dayOfMonth: OPTIONS.dayOfMonth },
          OPTIONS.time,
        );
        ok(scheduleFloorAllows(cron, minutes), `${unit} ${every}: ${cron}`);
      }
  });

  it("accepts every preset the picker shows", () => {
    for (const preset of PRESETS) {
      ok(presetAllowed(preset, OPTIONS, rule), preset);
      const cron = presetToCron(preset, OPTIONS);
      ok(scheduleFloorAllows(cron, minutes), `${preset}: ${cron}`);
    }
  });
});
