import { expect, test } from "vitest";
import { parsePlanMinIntervalRefusal } from "./plan-min-interval";

const body = {
  error:
    "This person's plan runs a scheduled task at most once every 15 minutes.",
  code: "plan_min_interval",
  minIntervalMinutes: 15,
};

test("the exact refusal parses", () => {
  expect(parsePlanMinIntervalRefusal(body)).toEqual(body);
});

test("anything else is not this refusal", () => {
  for (const value of [
    null,
    "plan_min_interval",
    { ...body, code: "message_limit" },
    { ...body, error: undefined },
    { ...body, minIntervalMinutes: "15" },
    { ...body, minIntervalMinutes: 0 },
    { ...body, minIntervalMinutes: 15.5 },
    { error: "bad cron" },
  ])
    expect(parsePlanMinIntervalRefusal(value)).toBeNull();
});
