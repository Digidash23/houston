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
  presetAllowed,
  type ScheduleFloor,
  scheduleSaveBlocked,
} from "../src/schedule-floor.ts";
import type { SchedulePreset } from "../src/types.ts";

/**
 * A stand-in for the plan rule the app binds (the SDK's real-gap rule): a
 * minute step restarts at the top of the hour, so `*\/16` fires :48 then :00.
 * The builder only ever asks the rule; it never judges a cadence itself.
 */
function minuteStepGap(cron: string): number | null {
  if (cron === "* * * * *") return 1;
  const step = cron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (!step) return null;
  const n = Number(step[1]);
  const last = Math.floor(59 / n) * n;
  return last === 0 ? 60 : Math.min(n, 60 - last);
}
const floorOf = (minutes: number): ScheduleFloor => ({
  minutes,
  allows: (cron) => {
    const gap = minuteStepGap(cron);
    return gap === null || gap >= minutes;
  },
});
const FREE = floorOf(15);
const COUNTS = floorMinuteCounts(FREE);
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

/** Run one stepper action and return where it landed, or null for none. */
function step(
  every: string,
  act: "down" | "up" | "commit",
): IntervalCount | null {
  let landed: IntervalCount | null = null;
  const stepper = floorStepper(every, "minutes", COUNTS, (to) => {
    landed = to;
  });
  assert.ok(stepper);
  const action = stepper[act];
  if (action === null) return null;
  action();
  return landed;
}

describe("schedule floor: the counts the rule offers", () => {
  it("offers exactly the minute counts the rule accepts", () => {
    assert.deepEqual(COUNTS, [
      15,
      20,
      21,
      22,
      ...Array.from({ length: 16 }, (_, i) => 30 + i),
    ]);
    assert.deepEqual(floorMinuteCounts(floorOf(61)), []);
  });

  it("offers every preset on Free and hides one the rule refuses", () => {
    for (const preset of ALL_PRESETS) {
      assert.equal(presetAllowed(preset, OPTS, undefined), true, preset);
      assert.equal(presetAllowed(preset, OPTS, FREE), true, preset);
    }
    const shown = ALL_PRESETS.filter((p) =>
      presetAllowed(p, OPTS, floorOf(45)),
    );
    assert.deepEqual(shown, ["hourly", "daily", "weekly", "monthly", "custom"]);
  });

  it("starts at the first offered count instead of 5 minutes", () => {
    assert.equal(defaultMinutesCount(undefined), 5);
    assert.equal(defaultMinutesCount(COUNTS), 15);
    assert.equal(defaultMinutesCount([]), 5);
  });

  it("lands on an offered count when the unit switches to minutes", () => {
    assert.equal(countForUnitSwitch("2", "minutes", COUNTS), "15");
    assert.equal(countForUnitSwitch("20", "minutes", COUNTS), null);
    assert.equal(countForUnitSwitch("25", "minutes", COUNTS), "30");
    assert.equal(countForUnitSwitch("50", "minutes", COUNTS), "45");
    assert.equal(countForUnitSwitch("2", "hours", COUNTS), null);
    assert.equal(countForUnitSwitch("", "minutes", COUNTS), null);
    assert.equal(countForUnitSwitch("2", "minutes", undefined), null);
  });
});

describe("schedule floor: the minutes stepper", () => {
  it("steps by one without a floor or on any other unit", () => {
    assert.equal(
      floorStepper("15", "minutes", undefined, () => {}),
      undefined,
    );
    assert.equal(
      floorStepper("15", "hours", COUNTS, () => {}),
      undefined,
    );
  });

  it("moves between offered counts, and past the top to 1 hour", () => {
    assert.equal(step("15", "down"), null);
    assert.deepEqual(step("20", "down"), { every: 15, unit: "minutes" });
    assert.deepEqual(step("15", "up"), { every: 20, unit: "minutes" });
    assert.deepEqual(step("22", "up"), { every: 30, unit: "minutes" });
    assert.deepEqual(step("45", "up"), { every: 1, unit: "hours" });
  });

  it("steps from a typed count the rule refuses to its neighbors", () => {
    // The press keeps focus, so no blur snap runs first.
    assert.deepEqual(step("5", "up"), { every: 15, unit: "minutes" });
    assert.deepEqual(step("17", "up"), { every: 20, unit: "minutes" });
    assert.deepEqual(step("17", "down"), { every: 15, unit: "minutes" });
    assert.deepEqual(step("", "up"), { every: 15, unit: "minutes" });
    assert.equal(step("", "down"), null);
  });

  it("snaps a typed count the rule refuses up on blur", () => {
    assert.deepEqual(step("5", "commit"), { every: 15, unit: "minutes" });
    assert.deepEqual(step("16", "commit"), { every: 20, unit: "minutes" });
    assert.deepEqual(step("50", "commit"), { every: 1, unit: "hours" });
    assert.deepEqual(step("90", "commit"), { every: 1, unit: "hours" });
    assert.equal(step("21", "commit"), null);
    assert.equal(step("", "commit"), null);
  });
});

describe("schedule floor: Save in the schedule editor", () => {
  it("is disabled under a floor while the builder emits no schedule", () => {
    assert.equal(scheduleSaveBlocked("", FREE), true);
    assert.equal(scheduleSaveBlocked("  ", FREE), true);
    assert.equal(scheduleSaveBlocked("*/15 * * * *", FREE), false);
  });

  it("is never disabled without a floor, as before", () => {
    assert.equal(scheduleSaveBlocked("", undefined), false);
  });
});

describe("schedule floor: what the builder emits", () => {
  it("emits nothing for a pick the rule refuses, so Save stays blocked", () => {
    for (const n of ["5", "14", "16", "25", "46"]) {
      const refused = deriveSchedule(pick({ intervalEvery: n, floor: FREE }));
      assert.equal(refused.floorOk, false, n);
      assert.equal(refused.cron, "", n);
      // The pick itself still reads honestly in the summary.
      assert.equal(refused.pickedCron, `*/${n} * * * *`, n);
    }
  });

  it("emits the cron for every count the rule accepts", () => {
    for (const n of ["15", "20", "22", "40", "45"])
      assert.equal(
        deriveSchedule(pick({ intervalEvery: n, floor: FREE })).cron,
        `*/${n} * * * *`,
      );
  });

  it("holds a minutes count past 59 until the blur snaps it", () => {
    assert.equal(
      deriveSchedule(pick({ intervalEvery: "90", floor: FREE })).cron,
      "",
    );
  });

  it("blocks a preset the rule refuses", () => {
    const d = deriveSchedule(
      pick({ activePreset: "every_30min", floor: floorOf(45) }),
    );
    assert.equal(d.cron, "");
    assert.equal(d.pickedCron, "*/30 * * * *");
  });

  it("asks the rule about hours too", () => {
    const d = deriveSchedule(
      pick({ intervalEvery: "5", intervalUnit: "hours", floor: FREE }),
    );
    assert.equal(d.cron, "0 */5 * * *");
  });

  it("changes nothing without a floor", () => {
    for (const [every, cron] of [
      ["1", "* * * * *"],
      ["5", "*/5 * * * *"],
      ["16", "*/16 * * * *"],
      ["90", "*/90 * * * *"],
      ["", ""],
    ])
      assert.equal(deriveSchedule(pick({ intervalEvery: every })).cron, cron);
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
      interp(DEFAULT_SCHEDULE_LABELS.minIntervalHint, { minutes: 15 }),
      "Routines run at most once every 15 minutes.",
    );
  });
});
