import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DEFAULT_SCHEDULE_LABELS, interp } from "../src/labels.ts";
import {
  type BuilderPick,
  deriveSchedule,
} from "../src/schedule-builder-derive.ts";
import type { ScheduleOptions } from "../src/schedule-cron-utils.ts";
import {
  countForUnitSwitch,
  defaultMinutesCount,
  floorMinuteCounts,
  floorStepper,
  type IntervalCount,
  minuteCountAllowed,
  presetAllowed,
  snapMinutesUp,
  stepMinutes,
} from "../src/schedule-floor.ts";
import type { SchedulePreset } from "../src/types.ts";

const FREE = 15;
const OPTS: ScheduleOptions = { time: "09:00", daysOfWeek: [1], dayOfMonth: 1 };
const ALL_PRESETS: SchedulePreset[] = [
  "every_30min",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "custom",
];

function pick(patch: Partial<BuilderPick>): BuilderPick {
  return {
    activePreset: "custom",
    options: OPTS,
    intervalEvery: "15",
    intervalUnit: "minutes",
    ...patch,
  };
}

describe("schedule floor: presets", () => {
  it("offers every preset without a floor and on Free's 15 minutes", () => {
    for (const preset of ALL_PRESETS) {
      assert.equal(presetAllowed(preset, undefined), true, preset);
      assert.equal(presetAllowed(preset, FREE), true, preset);
    }
  });

  it("drops a preset that fires more often than a higher floor", () => {
    const shown = ALL_PRESETS.filter((p) => presetAllowed(p, 45));
    assert.deepEqual(shown, ["hourly", "daily", "weekly", "monthly", "custom"]);
  });
});

describe("schedule floor: the minutes stepper", () => {
  it("offers only counts that divide the hour and reach the floor", () => {
    assert.deepEqual(floorMinuteCounts(FREE), [15, 20, 30]);
    assert.deepEqual(floorMinuteCounts(45), []);
    for (const n of [15, 20, 30])
      assert.equal(minuteCountAllowed(n, FREE), true);
    for (const n of [5, 14, 16, 25, 45, 60])
      assert.equal(minuteCountAllowed(n, FREE), false, String(n));
  });

  it("starts at the floor instead of 5 minutes", () => {
    assert.equal(defaultMinutesCount(undefined), 5);
    assert.equal(defaultMinutesCount(FREE), 15);
  });

  it("steps 15, 20, 30, then 1 hour, and never below 15", () => {
    assert.deepEqual(stepMinutes(15, FREE, 1), { every: 20, unit: "minutes" });
    assert.deepEqual(stepMinutes(20, FREE, 1), { every: 30, unit: "minutes" });
    assert.deepEqual(stepMinutes(30, FREE, 1), { every: 1, unit: "hours" });
    assert.deepEqual(stepMinutes(30, FREE, -1), { every: 20, unit: "minutes" });
    assert.equal(stepMinutes(15, FREE, -1), null);
    // An existing 5-minute schedule steps up into the offered counts.
    assert.deepEqual(stepMinutes(5, FREE, 1), { every: 15, unit: "minutes" });
    assert.equal(stepMinutes(5, FREE, -1), null);
  });

  it("snaps a typed count up to the nearest offered one, past 30 to 1 hour", () => {
    assert.deepEqual(snapMinutesUp(5, FREE), { every: 15, unit: "minutes" });
    assert.deepEqual(snapMinutesUp(16, FREE), { every: 20, unit: "minutes" });
    assert.deepEqual(snapMinutesUp(25, FREE), { every: 30, unit: "minutes" });
    assert.deepEqual(snapMinutesUp(45, FREE), { every: 1, unit: "hours" });
  });

  it("wires the stepper buttons and the blur snap", () => {
    const picks: IntervalCount[] = [];
    const at = (every: string) =>
      floorStepper(every, "minutes", FREE, (p) => picks.push(p));
    assert.equal(at("15")?.down, null);
    at("30")?.up?.();
    at("25")?.commit();
    at("20")?.commit(); // already offered: no snap
    at("")?.up?.(); // cleared field: plus lands on the first count
    assert.deepEqual(picks, [
      { every: 1, unit: "hours" },
      { every: 30, unit: "minutes" },
      { every: 15, unit: "minutes" },
    ]);
    // Hours, days and months, and no floor, step by one as always.
    assert.equal(
      floorStepper("2", "hours", FREE, () => {}),
      undefined,
    );
    assert.equal(
      floorStepper("5", "minutes", undefined, () => {}),
      undefined,
    );
  });

  it("lands on an offered count when the unit switches to minutes", () => {
    assert.equal(countForUnitSwitch("2", "minutes", FREE), "15");
    assert.equal(countForUnitSwitch("25", "minutes", FREE), "30");
    assert.equal(countForUnitSwitch("40", "minutes", FREE), "30");
    assert.equal(countForUnitSwitch("20", "minutes", FREE), null);
    assert.equal(countForUnitSwitch("2", "hours", FREE), null);
    assert.equal(countForUnitSwitch("2", "minutes", undefined), null);
  });
});

describe("schedule floor: what the builder emits", () => {
  it("emits nothing for a pick under the floor, so Save stays blocked", () => {
    const short = deriveSchedule(
      pick({ intervalEvery: "5", minIntervalMinutes: FREE }),
    );
    assert.equal(short.floorOk, false);
    assert.equal(short.cron, "");
    // The pick itself still reads honestly in the summary.
    assert.equal(short.pickedCron, "*/5 * * * *");
    const uneven = deriveSchedule(
      pick({ intervalEvery: "25", minIntervalMinutes: FREE }),
    );
    assert.equal(uneven.cron, "");
  });

  it("emits the cron once the pick reaches the floor", () => {
    const ok = deriveSchedule(pick({ minIntervalMinutes: FREE }));
    assert.equal(ok.floorOk, true);
    assert.equal(ok.cron, "*/15 * * * *");
  });

  it("blocks a preset under a higher floor", () => {
    const d = deriveSchedule(
      pick({ activePreset: "every_30min", minIntervalMinutes: 45 }),
    );
    assert.equal(d.cron, "");
    assert.equal(d.pickedCron, "*/30 * * * *");
  });

  it("never limits hours", () => {
    const d = deriveSchedule(
      pick({
        intervalEvery: "5",
        intervalUnit: "hours",
        minIntervalMinutes: FREE,
      }),
    );
    assert.equal(d.cron, "0 */5 * * *");
  });

  it("changes nothing without a floor", () => {
    assert.equal(
      deriveSchedule(pick({ intervalEvery: "1" })).cron,
      "* * * * *",
    );
    assert.equal(
      deriveSchedule(pick({ intervalEvery: "5" })).cron,
      "*/5 * * * *",
    );
    assert.equal(deriveSchedule(pick({ intervalEvery: "" })).cron, "");
    assert.equal(
      deriveSchedule(pick({ activePreset: "daily" })).cron,
      "0 9 * * *",
    );
    assert.equal(
      deriveSchedule(
        pick({ activePreset: "weekly", options: { ...OPTS, daysOfWeek: [] } }),
      ).cron,
      "",
    );
  });

  it("names the floor in the hint", () => {
    assert.equal(
      interp(DEFAULT_SCHEDULE_LABELS.minIntervalHint, { minutes: FREE }),
      "Routines run at most every 15 minutes.",
    );
  });
});
