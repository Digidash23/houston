import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DEFAULT_SCHEDULE_LABELS, interp } from "../src/labels.ts";
import {
  type BuilderPick,
  deriveSchedule,
} from "../src/schedule-builder-derive.ts";
import type { ScheduleOptions } from "../src/schedule-cron-utils.ts";
import {
  countAllowed,
  defaultMinutesCount,
  intervalGapMinutes,
  nearestAllowedCount,
  presetAllowed,
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

describe("schedule floor: real gaps", () => {
  it("reads the gap a step leaves when it restarts at the top of the hour", () => {
    // Pinned against @houston/domain minFireGapMinutes for every count 1-60.
    assert.equal(intervalGapMinutes(1, "minutes"), 1);
    assert.equal(intervalGapMinutes(15, "minutes"), 15);
    assert.equal(intervalGapMinutes(16, "minutes"), 12); // :48 then :00
    assert.equal(intervalGapMinutes(21, "minutes"), 18); // :42 then :00
    assert.equal(intervalGapMinutes(25, "minutes"), 10); // :50 then :00
    assert.equal(intervalGapMinutes(45, "minutes"), 15);
    assert.equal(intervalGapMinutes(60, "minutes"), 60);
    assert.equal(intervalGapMinutes(5, "hours"), 240); // 20:00 then 00:00
    assert.equal(intervalGapMinutes(1, "days"), 1440);
    assert.equal(intervalGapMinutes(1, "months"), 1440);
  });
});

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
  it("starts at the floor instead of 5 minutes", () => {
    assert.equal(defaultMinutesCount(undefined), 5);
    assert.equal(defaultMinutesCount(FREE), 15);
  });

  it("cannot step below the floor", () => {
    assert.equal(nearestAllowedCount(14, "minutes", FREE, -1), null);
    assert.equal(nearestAllowedCount(4, "minutes", FREE, -1), null);
    assert.equal(nearestAllowedCount(19, "minutes", FREE, -1), 15);
  });

  it("steps up past counts whose wrap would fire too soon", () => {
    assert.equal(nearestAllowedCount(16, "minutes", FREE, 1), 20);
    assert.equal(nearestAllowedCount(6, "minutes", FREE, 1), 15);
    assert.equal(nearestAllowedCount(46, "minutes", FREE, 1), 60);
  });

  it("leaves hours, days and months alone on Free", () => {
    for (const unit of ["hours", "days", "months"] as const)
      for (let n = 1; n <= 30; n++)
        assert.equal(countAllowed(n, unit, FREE), true, `${n} ${unit}`);
    assert.equal(nearestAllowedCount(0, "hours", FREE, -1), 1);
  });

  it("allows any count without a floor", () => {
    for (let n = 1; n <= 60; n++)
      assert.equal(countAllowed(n, "minutes", undefined), true, String(n));
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
    const wrap = deriveSchedule(
      pick({ intervalEvery: "25", minIntervalMinutes: FREE }),
    );
    assert.equal(wrap.cron, "");
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
