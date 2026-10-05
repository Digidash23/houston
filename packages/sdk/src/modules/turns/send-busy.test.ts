import type {
  EventStreamOptions,
  HoustonEngineClient,
  WireFrame,
} from "@houston/runtime-client";
import { EngineError } from "@houston/runtime-client";
import { afterEach, expect, test } from "vitest";
import { ScopeStore } from "../../store";
import type { FeedOutput } from "./feed-output";
import { MultiplexFeedOutput } from "./feed-output";
import {
  COMPUTE_BUSY_MESSAGE,
  computeBusyRefusal,
  SEND_BUSY_NOTICE_MS,
  SEND_BUSY_WAIT_MS,
  SendBusyClock,
} from "./send-busy";
import { sendHolding } from "./send-hold";
import { StreamRegistry } from "./stream-registry";
import { type StreamTuning, streamTurn } from "./turn-stream";
import {
  type ConversationVM,
  ConversationVmOutput,
  conversationScope,
} from "./vm-output";

const busy = (retryAfterMs = 1) =>
  new EngineError(
    503,
    JSON.stringify({
      error: "engine unavailable",
      code: "compute_busy",
      detail: "sandbox_queue_timeout",
      retryAfterMs,
    }),
  );

const noEvidence = {
  turnEnds: 0,
  turnEndAfter: () => new Promise<void>(() => {}),
};

test("only the gateway's compute_busy 503 reads as busy", () => {
  expect(computeBusyRefusal(busy())?.detail).toBe("sandbox_queue_timeout");
  const waking = new EngineError(
    503,
    JSON.stringify({ error: "engine unavailable", detail: "agent is waking" }),
  );
  expect(computeBusyRefusal(waking)).toBeNull();
  const refused = new EngineError(
    503,
    JSON.stringify({ error: "engine unavailable", code: "pod_wake_refused" }),
  );
  expect(computeBusyRefusal(refused)).toBeNull();
  expect(computeBusyRefusal(new Error("Load failed"))).toBeNull();
});

test("the busy clock honors the server's hint inside its bounds and its budget", () => {
  const clock = new SendBusyClock(undefined);
  const refusal = (retryAfterMs?: number) => ({
    code: "compute_busy" as const,
    error: "engine unavailable",
    retryAfterMs,
  });
  expect(clock.pauseFor(refusal(3_000))).toBe(3_000);
  expect(clock.pauseFor(refusal(1))).toBe(1_000);
  expect(clock.pauseFor(refusal(600_000))).toBe(30_000);
  expect(clock.pauseFor(refusal())).toBe(3_000);
  expect(clock.spent).toBe(false);
  expect(clock.noticeable).toBe(false);
  expect(SEND_BUSY_WAIT_MS).toBe(600_000);
  expect(SEND_BUSY_NOTICE_MS).toBe(15_000);
  // A spent budget leaves no pause to take.
  expect(
    new SendBusyClock({ sendBusyWaitMs: 0 }).pauseFor(refusal(3_000)),
  ).toBe(0);
});

test("a busy send goes out again, the same request, until it is admitted", async () => {
  let calls = 0;
  let busyCalls = 0;
  const accepted = await sendHolding(
    async () => {
      calls++;
      if (calls < 3) throw busy();
      return { turnId: "t-1" };
    },
    noEvidence,
    new AbortController().signal,
    { sendBusyNoticeMs: 0 },
    () => {},
    () => busyCalls++,
  );
  expect(accepted).toEqual({ turnId: "t-1" });
  expect(calls).toBe(3);
  expect(busyCalls).toBeGreaterThan(0);
});

test("a busy send says so only once the wait is long", async () => {
  let calls = 0;
  let busyCalls = 0;
  await sendHolding(
    async () => {
      if (++calls < 2) throw busy();
      return {};
    },
    noEvidence,
    new AbortController().signal,
    { sendBusyNoticeMs: 60_000 },
    () => {},
    () => busyCalls++,
  );
  expect(busyCalls).toBe(0);
});

test("a busy send past its budget rejects with the refusal", async () => {
  let calls = 0;
  const refusal = await sendHolding(
    async () => {
      calls++;
      throw busy();
    },
    noEvidence,
    new AbortController().signal,
    { sendBusyWaitMs: 30 },
    () => {},
  ).catch((e: unknown) => e);
  expect(computeBusyRefusal(refusal)).not.toBeNull();
  expect(calls).toBeGreaterThan(1);
});

// ---- end to end through streamTurn and the conversation VM ----

const registry = new StreamRegistry();
afterEach(() => registry.disposeAll());

const fast: StreamTuning = {
  idleTimeoutMs: 2_000,
  backoff: { initialMs: 1, maxMs: 2, jitter: () => 0 },
};

const sync = (running: boolean, seq: number): WireFrame => ({
  type: "sync",
  data: { running, partial: "", seq },
  seq,
});

async function waitFor(cond: () => boolean, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
}

/** An engine that refuses the first `refusals` sends as busy, then runs. */
function busyEngine(
  refusals: number,
  stream: (o: EventStreamOptions) => Promise<void>,
) {
  const nonces: Array<string | undefined> = [];
  const engine = {
    streamEvents: (_id: string, o: EventStreamOptions) => stream(o),
    async sendMessage(_id: string, _text: string, o?: { nonce?: string }) {
      nonces.push(o?.nonce);
      if (nonces.length <= refusals) throw busy();
    },
    async getHistory() {
      return { id: "c", title: "", messages: [] };
    },
  } as unknown as HoustonEngineClient;
  return { engine, nonces };
}

function vmOutput() {
  const store = new ScopeStore();
  const vm = new ConversationVmOutput(store);
  const seen: Array<ConversationVM["sendWaiting"]> = [];
  const output: FeedOutput = new MultiplexFeedOutput([vm]);
  const snapshot = (key: string) =>
    store.getSnapshot(conversationScope("Houston/Bo", key)) as ConversationVM;
  return { output, snapshot, seen, store };
}

test("the VM shows a long busy wait, then clears it once the send lands", async () => {
  const { output, snapshot } = vmOutput();
  let sawBusy = false;
  const { engine, nonces } = busyEngine(2, async (o) => {
    o.onEvent(sync(false, 0));
    await waitFor(() => {
      if (snapshot("activity-busy")?.sendWaiting === "busy") sawBusy = true;
      return nonces.length === 3;
    });
    o.onEvent({ type: "text", data: "Done", seq: 1 });
    o.onEvent({ type: "done", data: null, seq: 2 });
  });

  await streamTurn(
    engine,
    "Houston/Bo",
    "activity-busy",
    "hi",
    output,
    registry,
    {
      tuning: { ...fast, sendBusyNoticeMs: 0 },
    },
  );

  expect(sawBusy).toBe(true);
  expect(new Set(nonces).size).toBe(1); // one message, never doubled
  const vm = snapshot("activity-busy");
  expect(vm.sendWaiting).toBeUndefined();
  expect(vm.sessionStatus).toBe("completed");
});

test("a busy send past its budget settles with the typed notice, not an error message", async () => {
  const { output, snapshot } = vmOutput();
  const { engine } = busyEngine(Number.POSITIVE_INFINITY, async (o) => {
    o.onEvent(sync(false, 0));
    await new Promise<void>((resolve) =>
      o.signal?.addEventListener("abort", () => resolve(), { once: true }),
    );
  });

  await streamTurn(
    engine,
    "Houston/Bo",
    "activity-busy-out",
    "hi",
    output,
    registry,
    {
      tuning: { ...fast, sendBusyWaitMs: 20, sendBusyNoticeMs: 0 },
    },
  );

  const vm = snapshot("activity-busy-out");
  expect(vm.sendWaiting).toBeUndefined();
  const note = vm.feed.find((f) => f.feed_type === "system_message");
  expect(note?.data).toBe(COMPUTE_BUSY_MESSAGE);
  // The VM carries the kind, so a surface renders its own copy for it.
  expect(note?.notice).toBe("compute_busy");
});
