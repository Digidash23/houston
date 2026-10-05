import type {
  PlanSummary,
  TriggerPlanSkipCode,
  TriggerStatusItem,
} from "@houston/wire-types";
import { describe, expect, it } from "vitest";
import { triggerPlanSkipNotice } from "./trigger-skip-notice";

const free: PlanSummary = {
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
};
const LAST = "2026-10-05T19:43:49Z";
const item = (code: TriggerPlanSkipCode, count = 21): TriggerStatusItem => ({
  routine_id: "r1",
  status: "active",
  plan_skipped: { code, count, last_at: LAST },
});
const routines = (patch: Partial<NonNullable<PlanSummary["routines"]>>) => ({
  ...free,
  routines: {
    ...(free.routines as NonNullable<PlanSummary["routines"]>),
    ...patch,
  },
});

describe("triggerPlanSkipNotice", () => {
  it("says nothing without skipped events", () => {
    expect(triggerPlanSkipNotice(undefined, free)).toBeNull();
    expect(
      triggerPlanSkipNotice({ routine_id: "r1", status: "active" }, free),
    ).toBeNull();
    expect(
      triggerPlanSkipNotice(item("plan_min_interval", 0), free),
    ).toBeNull();
  });

  it("speaks only to a person on Free", () => {
    const skipped = item("plan_min_interval");
    expect(triggerPlanSkipNotice(skipped, undefined)).toBeNull();
    expect(
      triggerPlanSkipNotice(skipped, { ...free, plan: "plus" }),
    ).toBeNull();
  });

  it("names the minimum interval from the plan and offers Plus", () => {
    expect(triggerPlanSkipNotice(item("plan_min_interval"), free)).toEqual({
      reason: "min_interval",
      count: 21,
      lastAt: LAST,
      minIntervalMinutes: 15,
      actions: ["upgrade"],
    });
    const { routines: _, ...bare } = free;
    expect(
      triggerPlanSkipNotice(item("plan_min_interval"), bare),
    ).toMatchObject({ minIntervalMinutes: 15 });
  });

  it("offers to keep this routine, until it is the kept one", () => {
    expect(triggerPlanSkipNotice(item("plan_routine_limit", 3), free)).toEqual({
      reason: "routine_limit",
      count: 3,
      lastAt: LAST,
      actions: ["keep_routine", "upgrade"],
    });
    const keptHere = routines({
      kept: { orgSlug: "o", agentSlug: "a", routineId: "r1" },
    });
    expect(
      triggerPlanSkipNotice(item("plan_routine_limit"), keptHere),
    ).toBeNull();
    const keptElsewhere = routines({
      kept: { orgSlug: "o", agentSlug: "a", routineId: "r9" },
    });
    expect(
      triggerPlanSkipNotice(item("plan_routine_limit"), keptElsewhere)?.reason,
    ).toBe("routine_limit");
  });

  it("offers Resume only while routines are still paused", () => {
    expect(
      triggerPlanSkipNotice(item("plan_inactive"), routines({ paused: true })),
    ).toMatchObject({
      reason: "inactive_paused",
      actions: ["resume", "upgrade"],
    });
    expect(triggerPlanSkipNotice(item("plan_inactive"), free)).toMatchObject({
      reason: "inactive_resumed",
      actions: ["upgrade"],
    });
  });

  it("ignores a code it cannot explain", () => {
    const unknown = {
      routine_id: "r1",
      status: "active",
      plan_skipped: { code: "plan_future_rule", count: 2, last_at: LAST },
    } as unknown as TriggerStatusItem;
    expect(triggerPlanSkipNotice(unknown, free)).toBeNull();
  });
});
