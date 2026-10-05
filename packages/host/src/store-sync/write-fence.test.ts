import type {
  LeaseHolderState,
  WriteLeaseVerdict,
} from "@houston/runtime-client/object-sync";
import { afterEach, expect, test, vi } from "vitest";
import { WriteFence } from "./write-fence";

afterEach(() => {
  vi.useRealTimers();
});

const held: WriteLeaseVerdict = { state: "held" };
const fencedBy = (holder: LeaseHolderState): WriteLeaseVerdict => ({
  state: "fenced",
  holder,
});

function fence(probe?: () => Promise<WriteLeaseVerdict>, heartbeatMs = 1_000) {
  const lost: string[] = [];
  const holders: LeaseHolderState[] = [];
  const logs: string[] = [];
  const subject = new WriteFence({
    probe,
    heartbeatMs,
    onLost: (err) => lost.push(err.message),
    onHolder: (holder) => holders.push(holder),
    log: (message) => logs.push(message),
  });
  return { subject, lost, holders, logs };
}

test("a boot with no store check is always writable", async () => {
  const { subject } = fence();
  expect(await subject.writable()).toBe(true);
  subject.startHeartbeat();
  expect(subject.lost).toBe(false);
});

test("a check that finds nobody holding the lease latches and retires", async () => {
  const probe = vi.fn(async () => fencedBy("stale"));
  const { subject, lost, holders } = fence(probe);

  expect(await subject.writable()).toBe(false);
  expect(subject.lost).toBe(true);
  // Latched: no further asks, no second notice, even from a sync 409.
  expect(await subject.writable()).toBe(false);
  subject.lose({ message: "object store PUT failed (409)" });
  expect(probe).toHaveBeenCalledOnce();
  expect(lost).toEqual(["the store's write lease check answered 409"]);
  expect(holders).toEqual(["stale"]);
});

// Two running engines must not trade the lease through restarts: against a
// live holder the pod stands down, and retires only once it goes stale.
test("a live holder makes the pod stand down until it stops renewing", async () => {
  vi.useFakeTimers();
  let verdict = fencedBy("live");
  const probe = vi.fn(async () => verdict);
  const { subject, holders } = fence(probe, 1_000);
  subject.startHeartbeat();

  expect(await subject.writable()).toBe(false);
  expect(holders).toEqual(["live"]);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(holders).toEqual(["live"]);

  verdict = fencedBy("stale");
  await vi.advanceTimersByTimeAsync(1_000);
  expect(holders).toEqual(["live", "stale"]);
  // Stale is final: the heartbeat stops.
  const asks = probe.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5_000);
  expect(probe).toHaveBeenCalledTimes(asks);
});

test("a sync 409 asks the check who holds the lease", async () => {
  const probe = vi.fn(async () => fencedBy("live"));
  const { subject, lost, holders } = fence(probe);

  subject.lose({ message: "object store PUT a.json failed (409)" });
  expect(lost).toEqual(["object store PUT a.json failed (409)"]);
  await vi.waitFor(() => expect(holders).toEqual(["live"]));
});

test("a sync 409 with no check to ask retires", () => {
  const { subject, holders } = fence();
  subject.lose({ message: "object store PUT a.json failed (409)" });
  expect(holders).toEqual(["stale"]);
});

test("concurrent writes share one check", async () => {
  let answer!: (verdict: WriteLeaseVerdict) => void;
  const probe = vi.fn(
    () =>
      new Promise<WriteLeaseVerdict>((resolve) => {
        answer = resolve;
      }),
  );
  const { subject } = fence(probe);

  const first = subject.writable();
  const second = subject.writable();
  answer(held);
  expect(await Promise.all([first, second])).toEqual([true, true]);
  expect(probe).toHaveBeenCalledOnce();
  // The next write asks again: a held answer is never cached.
  const third = subject.writable();
  answer(held);
  expect(await third).toBe(true);
  expect(probe).toHaveBeenCalledTimes(2);
});

test("an unreachable store fails open and leaves a breadcrumb", async () => {
  const { subject, lost, logs } = fence(async () => {
    throw new Error("fetch failed");
  });
  expect(await subject.writable()).toBe(true);
  expect(lost).toEqual([]);
  expect(logs[0]).toContain("write lease check failed; accepting the write");
  expect(logs[0]).toContain("fetch failed");
});

// A pod-store replica from before the check route (a rolling deploy, or the
// engine landing first) must not switch the check off for the pod's life.
test("a store without the check is still asked on the next write", async () => {
  let verdict: WriteLeaseVerdict = { state: "unsupported" };
  const probe = vi.fn(async () => verdict);
  const { subject, logs } = fence(probe);
  expect(await subject.writable()).toBe(true);
  expect(await subject.writable()).toBe(true);
  expect(logs).toHaveLength(1);

  verdict = fencedBy("stale");
  expect(await subject.writable()).toBe(false);
  expect(probe).toHaveBeenCalledTimes(3);
});

// The incident's other half: an idle superseded pod kept firing its local
// copy of a routine for days. The heartbeat acts without any write.
test("the heartbeat finds a takeover on an idle pod", async () => {
  vi.useFakeTimers();
  let verdict: WriteLeaseVerdict = held;
  const probe = vi.fn(async () => verdict);
  const { subject, lost, holders } = fence(probe, 1_000);
  subject.startHeartbeat();

  await vi.advanceTimersByTimeAsync(1_000);
  expect(lost).toEqual([]);
  verdict = fencedBy("stale");
  await vi.advanceTimersByTimeAsync(1_000);
  expect(lost).toHaveLength(1);
  expect(holders).toEqual(["stale"]);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(probe).toHaveBeenCalledTimes(2);
});
