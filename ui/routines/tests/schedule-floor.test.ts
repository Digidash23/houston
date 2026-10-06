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
  minuteCountAllowed,
  presetAllowed,
  scheduleSaveBlocked,
  stepperBlurSnap,
  stepperCanDecrease,
  stepperDecrease,
  stepperIncrease,
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

describe("schedule floor: the minutes count", () => {
  it("is a plain minimum: any count at or above the floor is fine", () => {
    for (const n of [15, 16, 17, 25, 45, 59, 90])
      assert.equal(minuteCountAllowed(n, FREE), true, String(n));
    for (const n of [1, 5, 14])
      assert.equal(minuteCountAllowed(n, FREE), false, String(n));
    for (const n of [1, 5, 14])
      assert.equal(minuteCountAllowed(n, undefined), true, String(n));
  });

  it("starts at the floor instead of 5 minutes", () => {
    assert.equal(defaultMinutesCount(undefined), 5);
    assert.equal(defaultMinutesCount(FREE), 15);
  });

  it("raises a count below the floor when the unit switches to minutes", () => {
    assert.equal(countForUnitSwitch("2", "minutes", FREE), "15");
    assert.equal(countForUnitSwitch("20", "minutes", FREE), null);
    assert.equal(countForUnitSwitch("45", "minutes", FREE), null);
    assert.equal(countForUnitSwitch("2", "hours", FREE), null);
    assert.equal(countForUnitSwitch("", "minutes", FREE), null);
    assert.equal(countForUnitSwitch("2", "minutes", undefined), null);
  });
});

describe("schedule floor: the count stepper", () => {
  it("disables minus at the floor, and at 1 without one", () => {
    assert.equal(stepperCanDecrease(15, FREE), false);
    assert.equal(stepperCanDecrease(5, FREE), false);
    assert.equal(stepperCanDecrease(16, FREE), true);
    assert.equal(stepperCanDecrease(1, undefined), false);
    assert.equal(stepperCanDecrease(2, undefined), true);
  });

  it("steps by one, never below the floor", () => {
    assert.equal(stepperDecrease(16, FREE), 15);
    assert.equal(stepperDecrease(15, FREE), 15);
    assert.equal(stepperIncrease(15, FREE), 16);
    assert.equal(stepperIncrease(44, FREE), 45);
    assert.equal(stepperDecrease(2, undefined), 1);
    assert.equal(stepperIncrease(1, undefined), 2);
  });

  it("plus from a count under the floor lands on the floor, not one past", () => {
    // Typing 5 then pressing plus: the press keeps focus, so no blur snap
    // runs first and plus itself lands on 15.
    assert.equal(stepperIncrease(5, FREE), 15);
    assert.equal(stepperIncrease(14, FREE), 15);
  });

  it("snaps a typed count under the floor up to it on blur", () => {
    assert.equal(stepperBlurSnap("5", FREE), "15");
    assert.equal(stepperBlurSnap("0", FREE), "15");
    assert.equal(stepperBlurSnap("15", FREE), null);
    assert.equal(stepperBlurSnap("45", FREE), null);
    assert.equal(stepperBlurSnap("", FREE), null);
    assert.equal(stepperBlurSnap("5", undefined), null);
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
  it("emits nothing for a pick under the floor, so Save stays blocked", () => {
    const short = deriveSchedule(
      pick({ intervalEvery: "5", minIntervalMinutes: FREE }),
    );
    assert.equal(short.floorOk, false);
    assert.equal(short.cron, "");
    // The pick itself still reads honestly in the summary.
    assert.equal(short.pickedCron, "*/5 * * * *");
    const justUnder = deriveSchedule(
      pick({ intervalEvery: "14", minIntervalMinutes: FREE }),
    );
    assert.equal(justUnder.cron, "");
  });

  it("emits the cron for any count at or above the floor", () => {
    const ok = deriveSchedule(pick({ minIntervalMinutes: FREE }));
    assert.equal(ok.floorOk, true);
    assert.equal(ok.cron, "*/15 * * * *");
    for (const n of ["16", "25", "45"])
      assert.equal(
        deriveSchedule(pick({ intervalEvery: n, minIntervalMinutes: FREE }))
          .cron,
        `*/${n} * * * *`,
      );
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
