import { describe, expect, it, test } from "vitest";
import { minFireGapMinutes, scheduleFloorAllows } from "./schedule-gap";

test("the smallest gap between consecutive fires, whatever the cron spelling", () => {
  expect(minFireGapMinutes("* * * * *")).toBe(1);
  expect(minFireGapMinutes("*/5 * * * *")).toBe(5);
  expect(minFireGapMinutes("0-59/5 * * * *")).toBe(5);
  expect(minFireGapMinutes("0,5,10 * * * *")).toBe(5);
  expect(minFireGapMinutes("55,0 * * * *")).toBe(5);
  expect(minFireGapMinutes("0,5 9 * * 1")).toBe(5);
  expect(minFireGapMinutes("*/15 * * * *")).toBe(15);
  expect(minFireGapMinutes("0,20,40 * * * *")).toBe(20);
  expect(minFireGapMinutes("0 9 * * *")).toBe(1440);
});

test("no gap for a pattern that is invalid or never fires twice", () => {
  expect(minFireGapMinutes("not a cron")).toBeNull();
  expect(minFireGapMinutes("0 0 30 2 *")).toBeNull();
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
