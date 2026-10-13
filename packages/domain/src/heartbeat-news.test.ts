import type { Activity, Routine, RoutineRun } from "@houston/protocol";
import { describe, expect, test } from "vitest";
import { HEARTBEAT_SECTION_CAP } from "./heartbeat-coverage";
import {
  briefedThroughMs,
  heartbeatHasNews,
  heartbeatWindowStart,
} from "./heartbeat-news";
import {
  buildHeartbeatSnapshot,
  type HeartbeatAgentData,
} from "./heartbeat-snapshot";

const BRIEFED = "2026-10-10T08:00:00.000Z";
const BEFORE = "2026-10-10T07:00:00.000Z";
const AFTER = "2026-10-10T09:00:00.000Z";
const LONG_AGO = Date.parse("2026-01-01T00:00:00Z");
const at = (minute: number) =>
  new Date(Date.parse(BRIEFED) + minute * 60_000).toISOString();

const snapshotOf = (
  over: Partial<HeartbeatAgentData>,
  through: string | null = BRIEFED,
) =>
  buildHeartbeatSnapshot(
    [{ agentName: "Ana", activities: [], routines: [], runs: [], ...over }],
    LONG_AGO,
    briefedThroughMs(through),
  );
const mission = (status: string, updated_at?: string, title = "Invoice") =>
  ({
    id: `${status}-${updated_at}-${title}`,
    title,
    description: "",
    status,
    ...(updated_at ? { updated_at } : {}),
  }) as Activity;
const failedRun = (over: Partial<RoutineRun>): RoutineRun => ({
  id: "run",
  routine_id: "r1",
  status: "error",
  session_key: "routine-r1",
  started_at: BEFORE,
  ...over,
});
const paused = (pausedAt: string, name = "Daily report") =>
  ({
    id: name,
    name,
    prompt: "p",
    schedule: "0 9 * * *",
    enabled: false,
    suppress_when_silent: false,
    auto_paused: {
      reason: "out_of_credits",
      provider: "anthropic",
      failures: 3,
      at: pausedAt,
    },
  }) as Routine;

describe("only when there is news", () => {
  test("an empty snapshot is never news, not even before any briefing", () => {
    expect(heartbeatHasNews(snapshotOf({}, null), false)).toBe(false);
  });

  test("before any finished briefing, any item counts, timestamp or not", () => {
    const s = snapshotOf({ activities: [mission("needs_you")] }, null);
    expect(heartbeatHasNews(s, false)).toBe(true);
  });

  test("a mission still waiting since before the watermark is not news", () => {
    expect(
      heartbeatHasNews(
        snapshotOf({ activities: [mission("needs_you", BEFORE)] }),
        true,
      ),
    ).toBe(false);
    expect(
      heartbeatHasNews(
        snapshotOf({ activities: [mission("needs_you", AFTER)] }),
        true,
      ),
    ).toBe(true);
  });

  test("a mission with no updated_at is never fresh", () => {
    const s = snapshotOf({ activities: [mission("needs_you")] });
    expect(s.freshCount).toBe(0);
    expect(heartbeatHasNews(s, true)).toBe(false);
  });

  test("strictly newer, compared as instants", () => {
    const same = snapshotOf({
      activities: [mission("needs_you", "2026-10-10T10:00:00+02:00")],
    });
    expect(heartbeatHasNews(same, true)).toBe(false);
  });

  test("runs count by completed_at, else started_at", () => {
    expect(
      heartbeatHasNews(
        snapshotOf({ runs: [failedRun({ started_at: AFTER })] }),
        true,
      ),
    ).toBe(true);
    const completed = snapshotOf({
      runs: [failedRun({ started_at: AFTER, completed_at: BEFORE })],
    });
    expect(heartbeatHasNews(completed, true)).toBe(false);
  });

  test("a paused routine counts by when the engine paused it", () => {
    expect(
      heartbeatHasNews(snapshotOf({ routines: [paused(BEFORE)] }), true),
    ).toBe(false);
    expect(
      heartbeatHasNews(snapshotOf({ routines: [paused(AFTER)] }), true),
    ).toBe(true);
  });

  test("the window opens just past the watermark, else a day ago", () => {
    const now = Date.parse(AFTER);
    expect(heartbeatWindowStart(BRIEFED, now)).toBe(Date.parse(BRIEFED) + 1);
    expect(heartbeatWindowStart(null, now)).toBe(now - 86_400_000);
  });
});

describe("capping and coverage", () => {
  test("a fresh item is never cut behind already-briefed ones", () => {
    const old = Array.from({ length: HEARTBEAT_SECTION_CAP }, (_, i) =>
      paused(BEFORE, `old-${i}`),
    );
    const s = snapshotOf({ routines: [...old, paused(AFTER, "new")] });
    expect(s.pausedRoutines.items[0]?.routine).toBe("new");
    expect(s.pausedRoutines.more).toBe(1);
    expect(heartbeatHasNews(s, true)).toBe(true);
  });

  test("fresh items go oldest first, so the cap cuts only newer ones", () => {
    const fresh = Array.from({ length: HEARTBEAT_SECTION_CAP + 2 }, (_, i) =>
      mission("needs_you", at(i + 1), `m${i + 1}`),
    ).reverse();
    const s = snapshotOf({ activities: fresh });
    expect(s.needsYou.items[0]?.title).toBe("m1");
    expect(s.needsYou.items.at(-1)?.title).toBe(`m${HEARTBEAT_SECTION_CAP}`);
    expect(s.freshCount).toBe(HEARTBEAT_SECTION_CAP + 2);
    // Covered through the newest named item; the cut two stay fresh.
    expect(s.coveredThroughMs).toBe(Date.parse(at(HEARTBEAT_SECTION_CAP)));
  });

  test("coverage stops below a cut item even when another section is newer", () => {
    const fresh = Array.from({ length: HEARTBEAT_SECTION_CAP + 1 }, (_, i) =>
      mission("needs_you", at(i + 1), `m${i + 1}`),
    );
    const s = snapshotOf({
      activities: fresh,
      routines: [paused(at(90))],
    });
    const cut = Date.parse(at(HEARTBEAT_SECTION_CAP + 1));
    expect(s.coveredThroughMs).toBe(cut - 1);
  });

  test("a briefing naming no timestamped item covers nothing", () => {
    expect(
      snapshotOf({ activities: [mission("needs_you")] }).coveredThroughMs,
    ).toBeNull();
  });
});
