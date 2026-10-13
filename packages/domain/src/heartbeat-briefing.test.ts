import { describe, expect, test } from "vitest";
import {
  heartbeatDocKey,
  loadHeartbeat,
  loadHeartbeatDoc,
  normalizeHeartbeat,
} from "./heartbeat";
import {
  recordHeartbeatAdmitted,
  settleHeartbeatRun,
} from "./heartbeat-briefing";
import type { TextStore } from "./store";

const T0 = "2026-10-10T06:00:00.000Z";
const RUN = "2026-10-10T08:30:00.000Z";
const DONE = "2026-10-10T08:32:00.000Z";

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

const admit = (store: TextStore, coveredThroughMs: number | null) =>
  recordHeartbeatAdmitted(store, "P", {
    date: "2026-10-10",
    at: RUN,
    coveredThroughMs,
  });

describe("a briefing's two moments", () => {
  test("admission claims the day but moves no baseline", async () => {
    const store = memoryStore();
    await admit(store, Date.parse(T0));
    const doc = await loadHeartbeatDoc(store, "P");
    expect(doc.last).toEqual({
      status: "delivered",
      date: "2026-10-10",
      at: RUN,
    });
    expect(doc.pending).toEqual({ at: RUN, coveredThrough: T0 });
    expect(doc.briefedAt).toBeNull();
    expect(doc.briefedThrough).toBeNull();
    // Host-owned: never on the wire.
    expect(Object.keys(await loadHeartbeat(store, "P")).sort()).toEqual([
      "enabled",
      "last",
      "time",
    ]);
  });

  test("finishing moves the baseline to what it covered, never backwards", async () => {
    const store = memoryStore();
    await admit(store, Date.parse(T0));
    await settleHeartbeatRun(store, "P", { kind: "completed", at: DONE });
    let doc = await loadHeartbeatDoc(store, "P");
    expect(doc).toMatchObject({
      briefedAt: DONE,
      briefedThrough: T0,
      pending: null,
    });
    // A later briefing that named nothing timestamped keeps the watermark.
    await admit(store, null);
    await settleHeartbeatRun(store, "P", { kind: "completed", at: DONE });
    doc = await loadHeartbeatDoc(store, "P");
    expect(doc.briefedThrough).toBe(T0);
  });

  test("failing reads as an error and keeps the baseline", async () => {
    const store = memoryStore();
    await admit(store, Date.parse(T0));
    await settleHeartbeatRun(store, "P", {
      kind: "failed",
      at: DONE,
      reason: "overloaded",
    });
    const doc = await loadHeartbeatDoc(store, "P");
    expect(doc.last).toEqual({
      status: "error",
      date: "2026-10-10",
      at: DONE,
      reason: "overloaded",
    });
    expect(doc).toMatchObject({
      briefedAt: null,
      briefedThrough: null,
      pending: null,
    });
  });

  test("settling twice is a no-op the second time", async () => {
    const store = memoryStore();
    await admit(store, null);
    expect(
      await settleHeartbeatRun(store, "P", { kind: "completed", at: DONE }),
    ).not.toBeNull();
    expect(
      await settleHeartbeatRun(store, "P", { kind: "completed", at: DONE }),
    ).toBeNull();
    expect(store.files.has(heartbeatDocKey("P"))).toBe(true);
  });

  test("a document from before the record reads a delivered last as briefed", () => {
    const last = { status: "delivered", date: "2026-10-10", at: RUN } as const;
    expect(normalizeHeartbeat({ last })).toMatchObject({
      briefedAt: RUN,
      briefedThrough: RUN,
      pending: null,
    });
    // Written by this version: a delivered last with no finish is not briefed.
    expect(normalizeHeartbeat({ last, briefedAt: null }).briefedAt).toBeNull();
    expect(
      normalizeHeartbeat({ last: { ...last, status: "quiet" } }).briefedAt,
    ).toBeNull();
  });
});
