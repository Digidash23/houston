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
import { StreamRegistry, streamKey } from "./stream-registry";
import {
  observeConversation,
  type StreamTuning,
  streamTurn,
} from "./turn-stream";
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

async function waitFor(cond: () => boolean, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
}

// ---- the refusal and the clock ----

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
  expect(SEND_BUSY_WAIT_MS).toBe(600_000);
  expect(SEND_BUSY_NOTICE_MS).toBe(15_000);
  // A spent budget leaves no pause to take.
  expect(
    new SendBusyClock({ sendBusyWaitMs: 0 }).pauseFor(refusal(3_000)),
  ).toBe(0);
});

// ---- sendHolding ----

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
  expect(busyCalls).toBe(1);
});

test("a busy send is held, so the waiting stream's frames are not its turn's", async () => {
  let holds = 0;
  let calls = 0;
  await sendHolding(
    async () => {
      if (++calls < 3) throw busy();
      return {};
    },
    noEvidence,
    new AbortController().signal,
    undefined,
    () => holds++,
  );
  expect(holds).toBe(2);
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

test("the busy line comes on time, while the re-send is still waiting", async () => {
  const ac = new AbortController();
  let busyAt = 0;
  const started = Date.now();
  const sending = sendHolding(
    async () => {
      throw busy(5_000);
    },
    noEvidence,
    ac.signal,
    { sendBusyNoticeMs: 20 },
    () => {},
    () => {
      busyAt ||= Date.now();
    },
  ).catch(() => {});
  await waitFor(() => busyAt > 0, 1_000);
  ac.abort();
  await sending;
  // Well inside the 5 s pause the refusal asked for.
  expect(busyAt - started).toBeLessThan(1_000);
});

test("a busy refusal never re-sends past the budget, even after a long hint", async () => {
  let calls = 0;
  const refusal = await sendHolding(
    async () => {
      calls++;
      throw busy(5_000);
    },
    noEvidence,
    new AbortController().signal,
    { sendBusyWaitMs: 30 },
    () => {},
  ).catch((e: unknown) => e);
  expect(computeBusyRefusal(refusal)).not.toBeNull();
  // The pause was cut to the 30 ms left, then the spent budget stood.
  expect(calls).toBe(1);
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

type Stream = (o: EventStreamOptions) => Promise<void>;

const untilAborted: Stream = (o) =>
  new Promise<void>((resolve) => {
    if (o.signal?.aborted) return resolve();
    o.signal?.addEventListener("abort", () => resolve(), { once: true });
  });

/**
 * An engine that refuses the first `refusals` sends as busy, then runs. Each
 * stream connection takes the next handler (the last repeats).
 */
function busyEngine(refusals: number, ...streams: Stream[]) {
  const nonces: Array<string | undefined> = [];
  let connections = 0;
  const engine = {
    streamEvents: (_id: string, o: EventStreamOptions) =>
      (streams[Math.min(connections++, streams.length - 1)] ?? untilAborted)(o),
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
  const output: FeedOutput = new MultiplexFeedOutput([
    new ConversationVmOutput(store),
  ]);
  const snapshot = (key: string) =>
    store.getSnapshot(conversationScope("Houston/Bo", key)) as ConversationVM;
  return { output, snapshot };
}

/** Echo our send, then reply and end the turn. */
function reply(o: EventStreamOptions, nonce: string | undefined, seq: number) {
  o.onEvent({
    type: "user",
    data: { content: "hi", ts: 1, nonce },
    turnId: "t-mine",
    seq,
  });
  o.onEvent({ type: "text", data: "Done", turnId: "t-mine", seq: seq + 1 });
  o.onEvent({ type: "done", data: null, turnId: "t-mine", seq: seq + 2 });
}

test("the VM shows a long busy wait, then clears it once the send lands", async () => {
  const { output, snapshot } = vmOutput();
  let sawBusy = false;
  const { engine, nonces } = busyEngine(2, async (o) => {
    o.onEvent(sync(false, 0));
    // A teammate's turn ends while ours waits: never ours to settle on.
    o.onEvent({ type: "done", data: null, turnId: "t-other", seq: 1 });
    await waitFor(() => {
      if (snapshot("activity-busy")?.sendWaiting === "busy") sawBusy = true;
      return nonces.length === 3;
    });
    reply(o, nonces[2], 2);
  });

  await streamTurn(
    engine,
    "Houston/Bo",
    "activity-busy",
    "hi",
    output,
    registry,
    { tuning: { ...fast, sendBusyNoticeMs: 0 } },
  );

  expect(sawBusy).toBe(true);
  expect(new Set(nonces).size).toBe(1); // one message, never doubled
  const vm = snapshot("activity-busy");
  expect(vm.sendWaiting).toBeUndefined();
  expect(vm.sessionStatus).toBe("completed");
  expect(vm.feed.some((f) => f.data === "Done")).toBe(true);
});

test("a busy send past its budget settles with the typed notice, not an error message", async () => {
  const { output, snapshot } = vmOutput();
  const { engine } = busyEngine(Number.POSITIVE_INFINITY, async (o) => {
    o.onEvent(sync(false, 0));
    await untilAborted(o);
  });

  await streamTurn(
    engine,
    "Houston/Bo",
    "activity-busy-out",
    "hi",
    output,
    registry,
    { tuning: { ...fast, sendBusyWaitMs: 20, sendBusyNoticeMs: 0 } },
  );

  const vm = snapshot("activity-busy-out");
  expect(vm.sendWaiting).toBeUndefined();
  const note = vm.feed.find((f) => f.feed_type === "system_message");
  expect(note?.data).toBe(COMPUTE_BUSY_MESSAGE);
  // The VM carries the kind, so a surface renders its own copy for it.
  expect(note?.notice).toBe("compute_busy");
});

test("a busy refusal on the observer handoff is re-sent, held, on the fresh path", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-busy-handoff";
  const { engine, nonces } = busyEngine(
    1,
    // The observer of an idle conversation, until the turn takes over.
    async (o) => {
      o.onEvent(sync(false, 3));
      await untilAborted(o);
    },
    // Our turn's own subscription.
    async (o) => {
      await waitFor(() => nonces.length === 2);
      reply(o, nonces[1], 4);
    },
  );

  observeConversation(engine, "Houston/Bo", key, output, 1, registry, fast);
  await waitFor(
    () => registry.get(streamKey("Houston/Bo", key))?.kind === "observer",
  );
  await streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: fast,
  });

  expect(nonces).toHaveLength(2);
  expect(new Set(nonces).size).toBe(1);
  const vm = snapshot(key);
  expect(vm.feed.some((f) => f.feed_type === "system_message")).toBe(false);
  expect(vm.sessionStatus).toBe("completed");
});
