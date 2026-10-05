import { afterEach, expect, test, vi } from "vitest";
import { FENCE_RETIRE_DRAIN_MS, retireOnFenceLoss } from "./fence-retire";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function harness(stop: (opts: { drainMs: number }) => Promise<void>) {
  const events: string[] = [];
  const retire = retireOnFenceLoss({
    stop: async (opts) => {
      events.push(`stop ${opts.drainMs}`);
      await stop(opts);
    },
    exit: (code) => events.push(`exit ${code}`),
    flushReports: async () => events.push("flush"),
    deadlineMs: 1_000,
  });
  return { retire, events };
}

test("a fenced pod stops on a short drain, reports, then exits non-zero", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { retire, events } = harness(async () => {});

  retire();
  // A second loss notice (the sync's 409 after the check's) retires nothing new.
  retire();
  await vi.waitFor(() => expect(events).toContain("exit 1"));
  expect(events).toEqual([`stop ${FENCE_RETIRE_DRAIN_MS}`, "flush", "exit 1"]);
  expect(error).toHaveBeenCalledOnce();
  expect(error.mock.calls[0]?.[0]).toContain(
    "retiring it so the agent has one writer",
  );
});

test("a stop that hangs cannot keep the fenced pod serving", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { retire, events } = harness(() => new Promise<void>(() => {}));

  retire();
  await vi.advanceTimersByTimeAsync(999);
  expect(events).not.toContain("exit 1");
  await vi.advanceTimersByTimeAsync(1);
  expect(events).toContain("exit 1");
});

test("a stop that fails still exits", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { retire, events } = harness(async () => {
    throw new Error("server close failed");
  });

  retire();
  await vi.waitFor(() => expect(events).toContain("exit 1"));
  expect(error).toHaveBeenCalledWith(
    "[local-host] retire stop failed; exiting anyway:",
    expect.objectContaining({ message: "server close failed" }),
  );
});
