import type { WriteLeaseVerdict } from "@houston/runtime-client/object-sync";
import { afterEach, expect, test, vi } from "vitest";
import { WriteFence } from "./write-fence";

afterEach(() => {
  vi.useRealTimers();
});

function fence(probe?: () => Promise<WriteLeaseVerdict>, heartbeatMs = 1_000) {
  const lost: string[] = [];
  const logs: string[] = [];
  const subject = new WriteFence({
    probe,
    heartbeatMs,
    onLost: (err) => lost.push(err.message),
    log: (message) => logs.push(message),
  });
  return { subject, lost, logs };
}

test("a boot with no store check is always writable", async () => {
  const { subject } = fence();
  expect(await subject.writable()).toBe(true);
  subject.startHeartbeat();
  expect(subject.lost).toBe(false);
});

test("a fenced verdict latches the loss and tells the owner once", async () => {
  const probe = vi.fn(async (): Promise<WriteLeaseVerdict> => "fenced");
  const { subject, lost } = fence(probe);

  expect(await subject.writable()).toBe(false);
  expect(subject.lost).toBe(true);
  // Latched: no further asks, no second notice, even from a sync 409.
  expect(await subject.writable()).toBe(false);
  subject.lose({ message: "object store PUT failed (409)" });
  expect(probe).toHaveBeenCalledOnce();
  expect(lost).toEqual(["the store's write lease check answered 409"]);
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
  answer("held");
  expect(await Promise.all([first, second])).toEqual([true, true]);
  expect(probe).toHaveBeenCalledOnce();
  // The next write asks again: a held answer is never cached.
  const third = subject.writable();
  answer("held");
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

test("a store without the check is asked once, then trusted to its sync", async () => {
  const probe = vi.fn(async (): Promise<WriteLeaseVerdict> => "unsupported");
  const { subject, logs } = fence(probe);
  expect(await subject.writable()).toBe(true);
  expect(await subject.writable()).toBe(true);
  expect(probe).toHaveBeenCalledOnce();
  expect(logs).toHaveLength(1);
});

// The incident's other half: an idle superseded pod kept firing its local
// copy of a routine for days. The heartbeat retires it without any write.
test("the heartbeat finds a takeover on an idle pod", async () => {
  vi.useFakeTimers();
  let verdict: WriteLeaseVerdict = "held";
  const probe = vi.fn(async () => verdict);
  const { subject, lost } = fence(probe, 1_000);
  subject.startHeartbeat();

  await vi.advanceTimersByTimeAsync(1_000);
  expect(lost).toEqual([]);
  verdict = "fenced";
  await vi.advanceTimersByTimeAsync(1_000);
  expect(lost).toHaveLength(1);
  // The loss stops the heartbeat.
  await vi.advanceTimersByTimeAsync(5_000);
  expect(probe).toHaveBeenCalledTimes(2);
});
