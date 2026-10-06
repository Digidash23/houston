import { expect, test } from "vitest";
import { parseTurnLimits } from "./turn-limits";

test("a valid routine floor survives", () => {
  expect(parseTurnLimits({ routineMinIntervalMinutes: 15 })).toEqual({
    routineMinIntervalMinutes: 15,
  });
  expect(parseTurnLimits({ routineMinIntervalMinutes: 1 })).toEqual({
    routineMinIntervalMinutes: 1,
  });
  expect(parseTurnLimits({ routineMinIntervalMinutes: 1440 })).toEqual({
    routineMinIntervalMinutes: 1440,
  });
});

test("unknown fields are dropped", () => {
  expect(
    parseTurnLimits({ routineMinIntervalMinutes: 15, maxActive: 1 }),
  ).toEqual({ routineMinIntervalMinutes: 15 });
});

test("anything that is not a whole number of minutes in range is no limit", () => {
  for (const floor of [0, -5, 1441, 15.5, "15", null, Number.NaN, Infinity])
    expect(
      parseTurnLimits({ routineMinIntervalMinutes: floor }),
      String(floor),
    ).toBeUndefined();
});

test("a value that is not a plain object is no limits", () => {
  for (const value of [undefined, null, 15, "limits", [], [15], {}])
    expect(parseTurnLimits(value), JSON.stringify(value)).toBeUndefined();
});
