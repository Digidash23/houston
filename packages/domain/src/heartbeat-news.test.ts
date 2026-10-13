import type { Activity, Routine, RoutineRun } from "@houston/protocol";
import { describe, expect, test } from "vitest";
import {
  HEARTBEAT_LOOKBACK_MS,
  heartbeatHasNews,
  heartbeatWindowStart,
  seenAfterDelivery,
} from "./heartbeat-news";
import { HEARTBEAT_SECTION_CAP } from "./heartbeat-sections";
import {
  buildHeartbeatSnapshot,
  type HeartbeatAgentData,
} from "./heartbeat-snapshot";

const T = "2026-10-10T08:00:00.000Z";
const LONG_AGO = Date.parse("2026-01-01T00:00:00Z");

const snapshotOf = (
  over: Partial<HeartbeatAgentData>,
  seen: readonly string[] = [],
) =>
  buildHeartbeatSnapshot(
    [{ agentName: "Ana", activities: [], routines: [], runs: [], ...over }],
    LONG_AGO,
    new Set(seen),
  );
const mission = (id: string, status: string, updated_at?: string) =>
  ({
    id,
    title: id,
    description: "",
    status,
    ...(updated_at ? { updated_at } : {}),
  }) as Activity;
const failedRun = (id: string): RoutineRun => ({
  id,
  routine_id: "r1",
  status: "error",
  session_key: "routine-r1",
  started_at: T,
});
const paused = (id: string, at = T) =>
  ({
    id,
    name: id,
    prompt: "p",
    schedule: "0 9 * * *",
    enabled: false,
    suppress_when_silent: false,
    auto_paused: { reason: "out_of_credits", provider: "a", failures: 3, at },
  }) as Routine;

describe("identity keys", () => {
  test("one per item kind, scoped by agent", () => {
    const s = snapshotOf({
      activities: [mission("m1", "needs_you"), mission("m2", "done", T)],
      runs: [failedRun("run1")],
      routines: [paused("r9")],
    });
    expect(s.presentKeys.sort()).toEqual(
      [
        "done:Ana/m2",
        "need:Ana/m1",
        `pause:Ana/r9:${T}`,
        "run:Ana/run1",
      ].sort(),
    );
  });

  test("a re-pause is a new item", () => {
    const later = "2026-10-11T08:00:00.000Z";
    const s = snapshotOf({ routines: [paused("r9", later)] }, [
      `pause:Ana/r9:${T}`,
    ]);
    expect(heartbeatHasNews(s)).toBe(true);
  });
});

describe("only when there is news", () => {
  test("an empty snapshot is never news", () => {
    expect(heartbeatHasNews(snapshotOf({}))).toBe(false);
  });

  test("an unseen item is news, whatever its timestamps", () => {
    expect(
      heartbeatHasNews(
        snapshotOf({ activities: [mission("m1", "needs_you")] }),
      ),
    ).toBe(true);
  });

  test("an item already told is not, even if it was touched since", () => {
    const s = snapshotOf(
      { activities: [mission("m1", "needs_you", "2026-12-01T00:00:00Z")] },
      ["need:Ana/m1"],
    );
    expect(heartbeatHasNews(s)).toBe(false);
  });

  test("the look-back is a fixed window", () => {
    expect(heartbeatWindowStart(Date.parse(T))).toBe(
      Date.parse(T) - HEARTBEAT_LOOKBACK_MS,
    );
  });
});

describe("capping", () => {
  test("unseen items go first, so a cut never hides one behind told ones", () => {
    const told = Array.from({ length: HEARTBEAT_SECTION_CAP }, (_, i) =>
      paused(`old${i}`),
    );
    const s = snapshotOf(
      { routines: [...told, paused("new")] },
      told.map((r) => `pause:Ana/${r.id}:${T}`),
    );
    expect(s.pausedRoutines.items[0]?.routine).toBe("new");
    expect(s.namedKeys).toContain(`pause:Ana/new:${T}`);
  });

  test("items with one timestamp never starve: what the cap cut is named next", () => {
    const all = Array.from({ length: HEARTBEAT_SECTION_CAP + 1 }, (_, i) =>
      mission(`m${i}`, "needs_you", T),
    );
    const first = snapshotOf({ activities: all });
    expect(first.unseen).toBe(HEARTBEAT_SECTION_CAP + 1);
    const seen = seenAfterDelivery(first, []);
    expect(seen).toHaveLength(HEARTBEAT_SECTION_CAP);
    const second = snapshotOf({ activities: all }, seen);
    expect(heartbeatHasNews(second)).toBe(true);
    expect(second.unseen).toBe(1);
    expect(second.namedKeys[0]).not.toBe(undefined);
    expect(seen).not.toContain(second.namedKeys[0]);
  });
});

describe("seen after a confirmed delivery", () => {
  test("named keys, plus told keys still present; gone ones drop out", () => {
    const s = snapshotOf(
      { activities: [mission("m1", "needs_you"), mission("m2", "needs_you")] },
      ["need:Ana/m1", "need:Ana/gone"],
    );
    expect(
      seenAfterDelivery(s, ["need:Ana/m1", "need:Ana/gone"]).sort(),
    ).toEqual(["need:Ana/m1", "need:Ana/m2"]);
  });
});
