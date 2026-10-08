import type {
  PlanSummary,
  TriggerPlanSkipCode,
  TriggerStatusItem,
} from "@houston/wire-types";
import { describe, expect, it } from "vitest";
import {
  type TriggerPlanSkipViewer,
  triggerPlanSkipNotice,
} from "./trigger-skip-notice";

type PlanRoutines = NonNullable<PlanSummary["routines"]>;

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
const plus: PlanSummary = { ...free, plan: "plus" };
const LAST = "2026-10-05T19:43:49Z";
const creator: TriggerPlanSkipViewer = {
  createdBy: "u1",
  viewerId: "u1",
  agentSlug: "agent-a",
  orgSlug: "0123456789abcdef",
};
const member: TriggerPlanSkipViewer = { ...creator, viewerId: "u2" };
const item = (code: TriggerPlanSkipCode, count = 21): TriggerStatusItem => ({
  routine_id: "r1",
  status: "active",
  plan_skipped: { code, count, last_at: LAST },
});
const withRoutines = (patch: Partial<PlanRoutines>): PlanSummary => ({
  ...free,
  routines: { ...(free.routines as PlanRoutines), ...patch },
});
const kept = (agentSlug: string, orgSlug: string, routineId = "r1") =>
  withRoutines({ kept: { orgSlug, agentSlug, routineId } });

describe("triggerPlanSkipNotice for the routine's creator", () => {
  it("says nothing without skipped runs", () => {
    expect(triggerPlanSkipNotice(undefined, free, creator)).toBeNull();
    expect(
      triggerPlanSkipNotice(
        { routine_id: "r1", status: "active" },
        free,
        creator,
      ),
    ).toBeNull();
    expect(
      triggerPlanSkipNotice(item("plan_min_interval", 0), free, creator),
    ).toBeNull();
  });

  it("speaks only while the creator is on Free", () => {
    const skipped = item("plan_min_interval");
    expect(triggerPlanSkipNotice(skipped, undefined, creator)).toBeNull();
    expect(triggerPlanSkipNotice(skipped, plus, creator)).toBeNull();
  });

  it("names the minimum interval from the plan and offers Plus", () => {
    expect(
      triggerPlanSkipNotice(item("plan_min_interval"), free, creator),
    ).toEqual({
      reason: "min_interval",
      count: 21,
      lastAt: LAST,
      minIntervalMinutes: 15,
      actions: ["upgrade"],
    });
    const { routines: _, ...bare } = free;
    expect(
      triggerPlanSkipNotice(item("plan_min_interval"), bare, creator),
    ).toMatchObject({ minIntervalMinutes: 15 });
  });

  it("offers to keep this routine, until it is the kept one", () => {
    expect(
      triggerPlanSkipNotice(item("plan_routine_limit", 3), free, creator),
    ).toEqual({
      reason: "routine_limit",
      count: 3,
      lastAt: LAST,
      actions: ["keep_routine", "upgrade"],
    });
    const keptHere = kept("agent-a", "0123456789abcdef");
    expect(
      triggerPlanSkipNotice(item("plan_routine_limit"), keptHere, creator),
    ).toBeNull();
  });

  it("matches the kept routine by the gateway's whole key", () => {
    const limit = item("plan_routine_limit");
    // Same routine id under another agent or another space: still refused.
    for (const stale of [
      kept("agent-b", "0123456789abcdef"),
      kept("agent-a", "fedcba9876543210"),
      kept("agent-a", "0123456789abcdef", "r9"),
    ])
      expect(triggerPlanSkipNotice(limit, stale, creator)?.reason).toBe(
        "routine_limit",
      );
    // The personal space's org slug is not known client-side: agent + id.
    const personal = { ...creator, orgSlug: null };
    expect(
      triggerPlanSkipNotice(limit, kept("agent-a", "personal-org"), personal),
    ).toBeNull();
  });

  it("offers Resume first and never the chooser while routines are paused", () => {
    const paused = withRoutines({ paused: true });
    expect(
      triggerPlanSkipNotice(item("plan_routine_limit"), paused, creator),
    ).toMatchObject({
      reason: "routine_limit_paused",
      actions: ["resume", "upgrade"],
    });
    expect(
      triggerPlanSkipNotice(item("plan_inactive"), paused, creator),
    ).toMatchObject({
      reason: "inactive_paused",
      actions: ["resume", "upgrade"],
    });
    expect(
      triggerPlanSkipNotice(item("plan_inactive"), free, creator),
    ).toMatchObject({ reason: "inactive_resumed", actions: ["upgrade"] });
  });

  it("ignores a code it cannot explain", () => {
    const unknown = {
      routine_id: "r1",
      status: "active",
      plan_skipped: { code: "plan_future_rule", count: 2, last_at: LAST },
    } as unknown as TriggerStatusItem;
    expect(triggerPlanSkipNotice(unknown, free, creator)).toBeNull();
    expect(triggerPlanSkipNotice(unknown, free, member)).toBeNull();
  });
});

describe("triggerPlanSkipNotice for a routine naming no creator", () => {
  // An Agent Store install or an import strips `created_by`: it is the
  // viewer's own routine, judged like the creator's.
  const owner = { ...creator, createdBy: undefined };

  it("offers the Free viewer what fixes it", () => {
    expect(
      triggerPlanSkipNotice(item("plan_routine_limit"), free, owner),
    ).toMatchObject({
      reason: "routine_limit",
      actions: ["keep_routine", "upgrade"],
    });
    expect(
      triggerPlanSkipNotice(item("plan_min_interval"), free, {
        ...owner,
        viewerId: null,
      }),
    ).toMatchObject({ reason: "min_interval", actions: ["upgrade"] });
  });

  it("says nothing to a viewer on Plus", () => {
    expect(
      triggerPlanSkipNotice(item("plan_min_interval"), plus, owner),
    ).toBeNull();
  });
});

describe("triggerPlanSkipNotice for anyone else", () => {
  const readOnly = {
    reason: "creator_plan",
    count: 21,
    lastAt: LAST,
    actions: [],
  };

  it("tells a teammate whose plan it was, whatever their own plan", () => {
    for (const plan of [free, plus, undefined, withRoutines({ paused: true })])
      for (const code of [
        "plan_min_interval",
        "plan_routine_limit",
        "plan_inactive",
      ] as const)
        expect(triggerPlanSkipNotice(item(code), plan, member)).toEqual(
          readOnly,
        );
  });

  it("waits for the session before choosing a variant", () => {
    expect(
      triggerPlanSkipNotice(item("plan_min_interval"), free, {
        ...creator,
        viewerId: null,
      }),
    ).toBeNull();
  });
});
