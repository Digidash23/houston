import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  areaChart,
  dayLabel,
  formatCount,
  formatWork,
} from "../src/components/organization/org-chart-format.ts";

const THIN = String.fromCharCode(0x202f);
const HOUR = 3_600_000;

describe("formatCount", () => {
  it("groups thousands with a thin space in every shipped language", () => {
    for (const locale of ["en", "es", "pt"])
      strictEqual(formatCount(12140, locale), `12${THIN}140`);
  });

  it("keeps the locale's own decimal mark", () => {
    strictEqual(formatCount(4.5, "en", 1), "4.5");
    strictEqual(formatCount(4.5, "es", 1), "4,5");
  });
});

describe("formatWork", () => {
  it("reads a month of work in whole hours", () => {
    deepStrictEqual(formatWork(212.4 * HOUR, "en"), {
      value: "212",
      count: 212,
      unit: "hours",
    });
    strictEqual(formatWork(1212 * HOUR, "en").value, `1${THIN}212`);
  });

  it("keeps one decimal under ten hours", () => {
    deepStrictEqual(formatWork(4.46 * HOUR, "en"), {
      value: "4.5",
      count: 4.5,
      unit: "hours",
    });
    strictEqual(formatWork(3 * HOUR, "en").value, "3");
  });

  it("counts minutes under an hour, never zero hours for real work", () => {
    deepStrictEqual(formatWork(25 * 60_000, "en"), {
      value: "25",
      count: 25,
      unit: "minutes",
    });
    strictEqual(formatWork(10_000, "en").value, "1");
  });

  it("is a true zero only when nothing was worked", () => {
    deepStrictEqual(formatWork(0, "en"), {
      value: "0",
      count: 0,
      unit: "hours",
    });
  });
});

describe("areaChart", () => {
  it("lays a silent month flat on the baseline", () => {
    const chart = areaChart([0, 0, 0], 100, 50);
    strictEqual(chart.base, 49);
    strictEqual(chart.line, "3,49 50,49 97,49");
    deepStrictEqual(chart.end, { x: 97, y: 49 });
  });

  it("scales from zero with headroom above the peak and ends on today", () => {
    const chart = areaChart([0, 10, 5], 100, 50);
    const [first, peak, last] = chart.line
      .split(" ")
      .map((point) => point.split(",").map(Number));
    strictEqual(first?.[1], 49);
    strictEqual(Math.round(peak?.[1] ?? 0), 7);
    deepStrictEqual(chart.end, { x: last?.[0], y: last?.[1] });
    strictEqual(chart.area.startsWith("3,49 "), true);
    strictEqual(chart.area.endsWith(" 97,49"), true);
  });

  it("draws a single day as a flat line across the box", () => {
    strictEqual(areaChart([4], 100, 50).line.split(" ").length, 2);
  });
});

describe("dayLabel", () => {
  it("names the UTC day, whatever the viewer's zone", () => {
    strictEqual(
      dayLabel("en", "2026-08-28", { month: "short", day: "numeric" }),
      "Aug 28",
    );
  });
});
