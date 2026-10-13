import type { Activity, Routine, RoutineRun } from "@houston/protocol";
import { describe, expect, test } from "vitest";
import {
  heartbeatDocKey,
  loadHeartbeat,
  loadHeartbeatDoc,
  normalizeHeartbeat,
  recordHeartbeatRun,
} from "./heartbeat";
import { heartbeatHasNews, heartbeatWindowStart } from "./heartbeat-news";
import {
  buildHeartbeatSnapshot,
  HEARTBEAT_SECTION_CAP,
  type HeartbeatAgentData,
} from "./heartbeat-snapshot";
import type { TextStore } from "./store";

const DELIVERED = "2026-10-10T08:00:00.000Z";
const BEFORE = "2026-10-10T07:00:00.000Z";
const AFTER = "2026-10-10T09:00:00.000Z";
const LONG_AGO = Date.parse("2026-01-01T00:00:00Z");

const snapshotOf = (over: Partial<HeartbeatAgentData>) =>
  buildHeartbeatSnapshot(
    [{ agentName: "Ana", activities: [], routines: [], runs: [], ...over }],
    LONG_AGO,
  );
const mission = (status: string, updated_at?: string): Activity => ({
  id: `${status}-${updated_at}`,
  title: "Invoice",
  description: "",
  status,
  ...(updated_at ? { updated_at } : {}),
});
const failedRun = (at: Partial<RoutineRun>): RoutineRun => ({
  id: "run",
  routine_id: "r1",
  status: "error",
  session_key: "routine-r1",
  started_at: BEFORE,
  ...at,
});
const pausedRoutine = (at: string) =>
  ({
    id: "r1",
    name: "Daily report",
    prompt: "p",
    schedule: "0 9 * * *",
    enabled: false,
    suppress_when_silent: false,
    auto_paused: {
      reason: "out_of_credits",
      provider: "anthropic",
      failures: 3,
      at,
    },
  }) as Routine;

describe("only when there is news", () => {
  test("an empty snapshot is never news, not even on a first run", () => {
    expect(heartbeatHasNews(snapshotOf({}), null)).toBe(false);
  });

  test("a first-ever run counts any item, timestamp or not", () => {
    expect(
      heartbeatHasNews(
        snapshotOf({ activities: [mission("needs_you")] }),
        null,
      ),
    ).toBe(true);
    expect(
      heartbeatHasNews(
        snapshotOf({ activities: [mission("needs_you")] }),
        "garbage",
      ),
    ).toBe(true);
  });

  test("a mission still waiting since before the last briefing is not news", () => {
    const old = snapshotOf({ activities: [mission("needs_you", BEFORE)] });
    expect(heartbeatHasNews(old, DELIVERED)).toBe(false);
    const fresh = snapshotOf({ activities: [mission("needs_you", AFTER)] });
    expect(heartbeatHasNews(fresh, DELIVERED)).toBe(true);
  });

  test("a mission with no updated_at never counts on its own", () => {
    const s = snapshotOf({ activities: [mission("needs_you")] });
    expect(s.newestMs).toBeNull();
    expect(heartbeatHasNews(s, DELIVERED)).toBe(false);
  });

  test("strictly newer: an item at the very instant is not news", () => {
    const s = snapshotOf({ activities: [mission("done", DELIVERED)] });
    expect(heartbeatHasNews(s, DELIVERED)).toBe(false);
  });

  test("runs count by completed_at, else started_at", () => {
    const started = snapshotOf({ runs: [failedRun({ started_at: AFTER })] });
    expect(heartbeatHasNews(started, DELIVERED)).toBe(true);
    const completed = snapshotOf({
      runs: [failedRun({ started_at: AFTER, completed_at: BEFORE })],
    });
    expect(heartbeatHasNews(completed, DELIVERED)).toBe(false);
  });

  test("a paused routine counts by when the engine paused it", () => {
    expect(
      heartbeatHasNews(
        snapshotOf({ routines: [pausedRoutine(BEFORE)] }),
        DELIVERED,
      ),
    ).toBe(false);
    expect(
      heartbeatHasNews(
        snapshotOf({ routines: [pausedRoutine(AFTER)] }),
        DELIVERED,
      ),
    ).toBe(true);
  });

  test("an item past the section cap still counts", () => {
    // Paused routines keep their listed order, so the fresh one is the cut one.
    const old = Array.from({ length: HEARTBEAT_SECTION_CAP }, (_, i) => ({
      ...pausedRoutine(BEFORE),
      id: `old-${i}`,
    }));
    const s = snapshotOf({ routines: [...old, pausedRoutine(AFTER)] });
    expect(s.pausedRoutines.more).toBe(1);
    expect(heartbeatHasNews(s, DELIVERED)).toBe(true);
  });

  test("instants compare across ISO spellings", () => {
    const s = snapshotOf({
      activities: [mission("done", "2026-10-10T10:00:00+02:00")],
    });
    // 10:00+02:00 is 08:00Z: the same instant, so not newer.
    expect(heartbeatHasNews(s, DELIVERED)).toBe(false);
  });

  test("the window opens at the last delivery, else a day ago", () => {
    const now = Date.parse(AFTER);
    expect(heartbeatWindowStart(DELIVERED, now)).toBe(Date.parse(DELIVERED));
    expect(heartbeatWindowStart(null, now)).toBe(now - 86_400_000);
  });
});

function memoryStore(): TextStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    readText: async (key) => files.get(key) ?? null,
    writeText: async (key, content) => {
      files.set(key, content);
    },
  };
}

describe("the last delivered run", () => {
  test("a quiet or failed run never moves it, and it stays off the wire", async () => {
    const store = memoryStore();
    await recordHeartbeatRun(store, "P", {
      status: "delivered",
      date: "2026-10-10",
      at: DELIVERED,
    });
    await recordHeartbeatRun(store, "P", {
      status: "quiet",
      date: "2026-10-11",
      at: AFTER,
    });
    await recordHeartbeatRun(store, "P", {
      status: "error",
      date: "2026-10-12",
      at: AFTER,
      reason: "quota",
    });
    expect((await loadHeartbeatDoc(store, "P")).lastDeliveredAt).toBe(
      DELIVERED,
    );
    expect("lastDeliveredAt" in (await loadHeartbeat(store, "P"))).toBe(false);
    expect(store.files.has(heartbeatDocKey("P"))).toBe(true);
  });

  test("a document from before the field reads a delivered last as it", () => {
    const last = {
      status: "delivered",
      date: "2026-10-10",
      at: DELIVERED,
    } as const;
    expect(normalizeHeartbeat({ last }).lastDeliveredAt).toBe(DELIVERED);
    const quiet = { ...last, status: "quiet" } as const;
    expect(normalizeHeartbeat({ last: quiet }).lastDeliveredAt).toBeNull();
    expect(
      normalizeHeartbeat({ last: quiet, lastDeliveredAt: "bad" })
        .lastDeliveredAt,
    ).toBeNull();
  });
});
