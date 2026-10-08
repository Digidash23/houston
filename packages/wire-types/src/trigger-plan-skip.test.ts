import { describe, expect, it } from "vitest";
import { parseTriggerPlanSkipped } from "./trigger-plan-skip";

const valid = {
  code: "plan_min_interval",
  count: 21,
  last_at: "2026-10-05T19:43:49Z",
};

describe("parseTriggerPlanSkipped", () => {
  it("keeps every known code", () => {
    for (const code of [
      "plan_min_interval",
      "plan_routine_limit",
      "plan_inactive",
    ])
      expect(parseTriggerPlanSkipped({ ...valid, code })).toEqual({
        ...valid,
        code,
      });
  });

  it("drops extra keys a newer gateway adds", () => {
    expect(parseTriggerPlanSkipped({ ...valid, window: "24h" })).toEqual(valid);
  });

  it("drops a code it cannot explain rather than guessing", () => {
    expect(
      parseTriggerPlanSkipped({ ...valid, code: "plan_new_rule" }),
    ).toBeNull();
  });

  it("drops a shape that cannot be trusted", () => {
    for (const bad of [
      null,
      "plan_min_interval",
      { ...valid, count: 0 },
      { ...valid, count: 2.5 },
      { ...valid, count: "21" },
      { ...valid, last_at: "yesterday" },
      { code: valid.code, count: valid.count },
    ])
      expect(parseTriggerPlanSkipped(bad)).toBeNull();
  });
});
