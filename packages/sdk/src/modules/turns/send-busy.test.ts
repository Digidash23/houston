import type {
  EventStreamOptions,
  HoustonEngineClient,
  WireFrame,
} from "@houston/runtime-client";
import { EngineError } from "@houston/runtime-client";
import { afterEach, expect, test, vi } from "vitest";
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
import { armHandoffStop } from "./send-wait";
import { StreamRegistry, streamKey } from "./stream-registry";
import { STOPPED_BY_USER } from "./turn-errors";
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
    { onHold: () => {}, onBusy: () => busyCalls++ },
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
    { onHold: () => holds++ },
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
    { onHold: () => {}, onBusy: () => busyCalls++ },
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
    {
      onHold: () => {},
      onBusy: () => {
        busyAt ||= Date.now();
      },
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
    { onHold: () => {} },
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

test("a handoff's busy refusal is waited out, held, before the first re-send", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-busy-handoff-wait";
  const sentAt: number[] = [];
  const { engine, nonces } = busyEngine(
    1,
    async (o) => {
      o.onEvent(sync(false, 3));
      await untilAborted(o);
    },
    async (o) => {
      // An idle resync while the re-send waits: never this turn's settle.
      o.onEvent(sync(false, 3));
      await waitFor(() => nonces.length === 2);
      reply(o, nonces[1], 4);
    },
  );
  const send = engine.sendMessage.bind(engine);
  engine.sendMessage = (async (...args: Parameters<typeof send>) => {
    sentAt.push(Date.now());
    return send(...args);
  }) as typeof engine.sendMessage;

  observeConversation(engine, "Houston/Bo", key, output, 1, registry, fast);
  await waitFor(
    () => registry.get(streamKey("Houston/Bo", key))?.kind === "observer",
  );
  await streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: fast,
  });

  expect(sentAt).toHaveLength(2);
  // The refusal's hint (1 ms, floored to 1 s) is waited out, not skipped.
  expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(900);
  expect(snapshot(key).sessionStatus).toBe("completed");
});

test("Stop ends a message still waiting for room: no re-send after it", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-busy-stop";
  const { engine, nonces } = busyEngine(Number.POSITIVE_INFINITY, async (o) => {
    o.onEvent(sync(false, 0));
    await untilAborted(o);
  });

  const turn = streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: { ...fast, sendBusyNoticeMs: 0 },
  });
  await waitFor(() => snapshot(key)?.sendWaiting === "busy");
  const finish = registry.stopUnsent(streamKey("Houston/Bo", key));
  expect(finish).not.toBeNull();
  const sends = nonces.length;
  // Nothing settles before the engine's cancel answered: a message queued
  // behind this turn must not go out while that cancel could stop it.
  await new Promise((r) => setTimeout(r, 1_200));
  expect(snapshot(key).boardStatus).not.toBe("needs_you");
  // Held meanwhile, so the queue watchdog flushes nothing into that cancel.
  expect(registry.get(streamKey("Houston/Bo", key))?.held).toBe(true);
  finish?.();
  await turn;

  expect(nonces.length).toBe(sends); // nothing goes out after Stop
  const vm = snapshot(key);
  expect(vm.sendWaiting).toBeUndefined();
  expect(vm.boardStatus).toBe("needs_you");
  expect(vm.feed.some((f) => f.data === STOPPED_BY_USER)).toBe(true);
});

test("Stop leaves an accepted turn to the engine's own cancel", async () => {
  const { output } = vmOutput();
  const key = "activity-accepted-stop";
  let accepted = false;
  const { engine } = busyEngine(0, async (o) => {
    o.onEvent(sync(false, 0));
    await waitFor(() => accepted);
    await untilAborted(o);
  });
  const sendMessage = engine.sendMessage.bind(engine);
  engine.sendMessage = (async (...args: Parameters<typeof sendMessage>) => {
    const answer = await sendMessage(...args);
    accepted = true;
    return answer;
  }) as typeof engine.sendMessage;

  void streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: fast,
  });
  await waitFor(() => accepted);
  await new Promise((r) => setTimeout(r, 10));
  expect(registry.stopUnsent(streamKey("Houston/Bo", key))).toBeNull();
});

test("a teardown takes the busy line down at once", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-busy-teardown";
  const { engine } = busyEngine(Number.POSITIVE_INFINITY, async (o) => {
    o.onEvent(sync(false, 0));
    await untilAborted(o);
  });

  const turn = streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: { ...fast, sendBusyNoticeMs: 0 },
  });
  await waitFor(() => snapshot(key)?.sendWaiting === "busy");
  registry.disposeAll();
  expect(snapshot(key).sendWaiting).toBeUndefined();
  await turn;
  await new Promise((r) => setTimeout(r, 50));
  expect(snapshot(key).sendWaiting).toBeUndefined();
});

test("Stop reaches the observer handoff's send while it is still out", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-handoff-stop";
  let posts = 0;
  const { engine } = busyEngine(0, async (o) => {
    o.onEvent(sync(false, 3));
    await untilAborted(o);
  });
  // The handoff's POST waits in the gateway's queue until aborted.
  engine.sendMessage = ((
    _id: string,
    _text: string,
    o?: { signal?: AbortSignal },
  ) => {
    posts++;
    return new Promise((_resolve, reject) => {
      o?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  }) as typeof engine.sendMessage;

  observeConversation(engine, "Houston/Bo", key, output, 1, registry, fast);
  await waitFor(
    () => registry.get(streamKey("Houston/Bo", key))?.kind === "observer",
  );
  const turn = streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: fast,
  });
  await waitFor(() => posts === 1);
  const finish = registry.stopUnsent(streamKey("Houston/Bo", key));
  expect(finish).not.toBeNull();
  finish?.();
  await turn;
  await new Promise((r) => setTimeout(r, 1_200));

  expect(posts).toBe(1); // never re-sent
  const vm = snapshot(key);
  expect(vm.boardStatus).toBe("needs_you");
  expect(vm.feed.some((f) => f.data === STOPPED_BY_USER)).toBe(true);
});

test("a stream that keeps failing while the send waits for room never ends the turn", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-busy-stream-refused";
  let nonceSeen: () => string | undefined = () => undefined;
  let accepted = false;
  let connections = 0;
  const refusedStream: Stream = async () => {
    connections++;
    throw new EngineError(
      503,
      JSON.stringify({ error: "engine unavailable", code: "pod_wake_refused" }),
    );
  };
  const { engine, nonces } = busyEngine(2, async (o) => {
    // Every connection fails until the send lands, far past the stream's
    // eight-attempt budget.
    if (!accepted) return refusedStream(o);
    o.onEvent(sync(false, 0));
    reply(o, nonceSeen(), 1);
  });
  nonceSeen = () => nonces[2];
  const send = engine.sendMessage.bind(engine);
  engine.sendMessage = (async (...args: Parameters<typeof send>) => {
    const answer = await send(...args);
    accepted = true;
    return answer;
  }) as typeof engine.sendMessage;

  await streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    // Real waits between attempts: a zero draw with a refusal that throws at
    // once would retry on microtasks alone and starve the send's timers.
    tuning: {
      ...fast,
      backoff: { initialMs: 5, maxMs: 10, jitter: (cap) => cap },
    },
  });

  expect(connections).toBeGreaterThan(8);
  expect(snapshot(key).sessionStatus).toBe("completed");
});

const podWakeRefused = () =>
  new EngineError(
    503,
    JSON.stringify({ error: "engine unavailable", code: "pod_wake_refused" }),
  );

/** Real waits between stream attempts (see the test above). */
const paced: StreamTuning = {
  ...fast,
  backoff: { initialMs: 5, maxMs: 10, jitter: (cap) => cap },
};

test("a stream that fails while the first send is still out never ends the turn", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-first-send-stream-refused";
  let accepted = false;
  let failures = 0;
  const { engine, nonces } = busyEngine(0, async (o) => {
    if (!accepted) {
      failures++;
      throw podWakeRefused();
    }
    o.onEvent(sync(false, 0));
    reply(o, nonces[0], 1);
  });
  const send = engine.sendMessage.bind(engine);
  // The first POST sits in the gateway's queue past the stream's budget.
  engine.sendMessage = (async (...args: Parameters<typeof send>) => {
    await waitFor(() => failures > 12);
    const answer = await send(...args);
    accepted = true;
    return answer;
  }) as typeof engine.sendMessage;

  await streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: paced,
  });

  expect(snapshot(key).sessionStatus).toBe("completed");
});

test("once the send is taken, a frame gives the stream its own budget, no more", async () => {
  const { output } = vmOutput();
  const key = "activity-stream-budget-reset";
  let accepted = false;
  let framed = false;
  let failedWaiting = 0;
  let failedAfter = 0;
  const { engine } = busyEngine(1, async (o) => {
    if (!accepted) {
      failedWaiting++;
      throw podWakeRefused();
    }
    if (!framed) {
      framed = true;
      o.onEvent(sync(true, 1));
      return;
    }
    failedAfter++;
    throw podWakeRefused();
  });
  const send = engine.sendMessage.bind(engine);
  engine.sendMessage = (async (...args: Parameters<typeof send>) => {
    const answer = await send(...args);
    accepted = true;
    return answer;
  }) as typeof engine.sendMessage;

  await streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: paced,
  });

  expect(failedWaiting).toBeGreaterThan(8);
  // Eight attempts after the frame, the stream's own budget: the failures
  // during the wait are not added on top.
  expect(failedAfter).toBe(8);
});

test("a Stop waits for the engine's cancel to answer, however long it takes", async () => {
  vi.useFakeTimers();
  try {
    const stops = new StreamRegistry();
    const handoff = armHandoffStop(stops, "k");
    const finish = stops.stopUnsent("k");
    expect(finish).not.toBeNull();
    let answered = false;
    void handoff.stopped()?.then(() => {
      answered = true;
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(answered).toBe(false);
    finish?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toBe(true);
    handoff.disarm();
  } finally {
    vi.useRealTimers();
  }
});

test("a send waiting for room reads as held, so the queue watchdog leaves it", async () => {
  const { output } = vmOutput();
  const key = "activity-busy-held";
  const entry = () => registry.get(streamKey("Houston/Bo", key));
  let heldWhileWaiting = false;
  const { engine, nonces } = busyEngine(1, async (o) => {
    o.onEvent(sync(false, 0));
    await waitFor(() => {
      if (nonces.length === 1 && entry()?.held === true)
        heldWhileWaiting = true;
      return nonces.length === 2;
    });
    // Accepted: the send no longer waits.
    await waitFor(() => entry()?.held === false);
    reply(o, nonces[1], 1);
  });

  await streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: fast,
  });

  expect(heldWhileWaiting).toBe(true);
});

test("a stopped handoff streams nothing and stays held until the cancel answered", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-handoff-stop-wait";
  let connections = 0;
  const { engine } = busyEngine(
    0,
    // The observer, mid-turn at seq 3.
    async (o) => {
      connections++;
      o.onEvent({
        type: "sync",
        data: { running: true, partial: "", turnId: "t-prev", seq: 3 },
        seq: 3,
      });
      await untilAborted(o);
    },
    // A subscription from the observer's cursor would open on an idle resync:
    // "the turn ended unexpectedly", before the cancel answered.
    async (o) => {
      connections++;
      o.onEvent({
        type: "sync",
        data: { running: false, partial: "", resync: true, seq: 4 },
        seq: 4,
      });
      await untilAborted(o);
    },
  );
  let posted = false;
  engine.sendMessage = ((
    _id: string,
    _text: string,
    o?: { signal?: AbortSignal },
  ) => {
    posted = true;
    return new Promise((_resolve, reject) => {
      o?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  }) as typeof engine.sendMessage;

  observeConversation(engine, "Houston/Bo", key, output, 1, registry, fast);
  await waitFor(
    () => registry.get(streamKey("Houston/Bo", key))?.kind === "observer",
  );
  const turn = streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: fast,
  });
  await waitFor(() => posted);
  const finish = registry.stopUnsent(streamKey("Houston/Bo", key));
  await waitFor(
    () => registry.get(streamKey("Houston/Bo", key))?.kind === "turn",
  );
  await new Promise((r) => setTimeout(r, 100));

  expect(connections).toBe(1);
  expect(registry.get(streamKey("Houston/Bo", key))?.held).toBe(true);
  expect(snapshot(key).boardStatus).not.toBe("needs_you");
  expect(snapshot(key).boardStatus).not.toBe("error");
  finish?.();
  await turn;

  const vm = snapshot(key);
  expect(vm.boardStatus).toBe("needs_you");
  expect(vm.feed.some((f) => f.data === STOPPED_BY_USER)).toBe(true);
});

test("a Stop during the first send holds the turn until the cancel answered", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-first-send-stop";
  const { engine } = busyEngine(0, async (o) => {
    o.onEvent(sync(false, 0));
    await untilAborted(o);
  });
  let posted = false;
  // The first POST waits in the gateway's queue until aborted.
  engine.sendMessage = ((
    _id: string,
    _text: string,
    o?: { signal?: AbortSignal },
  ) => {
    posted = true;
    return new Promise((_resolve, reject) => {
      o?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  }) as typeof engine.sendMessage;

  const turn = streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: fast,
  });
  await waitFor(() => posted);
  const finish = registry.stopUnsent(streamKey("Houston/Bo", key));
  await new Promise((r) => setTimeout(r, 50));
  expect(registry.get(streamKey("Houston/Bo", key))?.held).toBe(true);
  expect(snapshot(key).boardStatus).not.toBe("needs_you");
  finish?.();
  await turn;

  expect(snapshot(key).feed.some((f) => f.data === STOPPED_BY_USER)).toBe(true);
});

test("a handoff's busy wait counts from when its send went out", async () => {
  expect(
    new SendBusyClock({ sendBusyWaitMs: 1_000 }, Date.now() - 1_000).spent,
  ).toBe(true);
  let busyCalls = 0;
  let sends = 0;
  const started = Date.now();
  // The handoff's POST sat 900 ms in the gateway's queue before its refusal:
  // 100 ms of the 1 s budget is left, and the 50 ms notice is overdue.
  const refusal = await sendHolding(
    async () => {
      sends++;
      return {};
    },
    noEvidence,
    new AbortController().signal,
    { sendBusyNoticeMs: 50, sendBusyWaitMs: 1_000 },
    {
      onHold: () => {},
      onBusy: () => busyCalls++,
      firstRefusal: busy(),
      busySince: Date.now() - 900,
    },
  ).catch((e: unknown) => e);
  expect(computeBusyRefusal(refusal)).not.toBeNull();
  expect(sends).toBe(0);
  expect(busyCalls).toBe(1);
  expect(Date.now() - started).toBeLessThan(500);
});

test("a teardown aborts the busy re-send still out, and a late refusal settles nothing", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-busy-teardown-late";
  const persisted: string[] = [];
  output.persistBoardStatus = async (_agent, _session, status) => {
    persisted.push(status);
  };
  const { engine } = busyEngine(0, async (o) => {
    o.onEvent(sync(false, 0));
    await untilAborted(o);
  });
  let calls = 0;
  let outSignal: AbortSignal | undefined;
  engine.sendMessage = (async (
    _id: string,
    _text: string,
    o?: { signal?: AbortSignal },
  ) => {
    if (++calls === 1) throw busy();
    outSignal = o?.signal;
    // A binding that ignores the abort: its refusal still lands, late.
    await new Promise((r) => setTimeout(r, 100));
    throw busy();
  }) as typeof engine.sendMessage;

  const turn = streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: fast,
  });
  await waitFor(() => outSignal !== undefined);
  const persistedBefore = persisted.length;
  registry.disposeAll();
  expect(outSignal?.aborted).toBe(true);
  await turn;

  expect(persisted.slice(persistedBefore)).toEqual([]);
  expect(snapshot(key).feed.some((f) => f.feed_type === "system_message")).toBe(
    false,
  );
});

test("the fresh path's busy budget includes the handoff send's queue wait", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-handoff-busy-since";
  const { engine } = busyEngine(0, async (o) => {
    o.onEvent(sync(false, 3));
    await untilAborted(o);
  });
  let sends = 0;
  engine.sendMessage = (async () => {
    // The handoff's POST waits 1.1 s in the gateway's queue; every send is
    // refused for room.
    if (++sends === 1) await new Promise((r) => setTimeout(r, 1_100));
    throw busy();
  }) as typeof engine.sendMessage;

  observeConversation(engine, "Houston/Bo", key, output, 1, registry, fast);
  await waitFor(
    () => registry.get(streamKey("Houston/Bo", key))?.kind === "observer",
  );
  await streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: { ...fast, sendBusyWaitMs: 1_200 },
  });

  // 100 ms of budget was left after the handoff: no re-send fits.
  expect(sends).toBe(1);
  const note = snapshot(key).feed.find((f) => f.feed_type === "system_message");
  expect(note?.notice).toBe("compute_busy");
});

test("an idle resync while the first send is still out settles nothing", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-first-send-resync";
  const { engine, nonces } = busyEngine(
    1,
    // The first connection drops before the send lands.
    async (o) => {
      o.onEvent(sync(false, 0));
      throw new Error("Load failed");
    },
    // The reconnect opens on the idle resync contract.
    async (o) => {
      o.onEvent({
        type: "sync",
        data: { running: false, partial: "", resync: true, seq: 1 },
        seq: 1,
      });
      await waitFor(() => nonces.length === 2);
      reply(o, nonces[1], 2);
    },
  );
  const send = engine.sendMessage.bind(engine);
  let first = true;
  engine.sendMessage = (async (...args: Parameters<typeof send>) => {
    // The first POST waits in the gateway's queue, then is refused for room.
    if (first) {
      first = false;
      await new Promise((r) => setTimeout(r, 300));
    }
    return send(...args);
  }) as typeof engine.sendMessage;

  await streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: fast,
  });

  expect(nonces).toHaveLength(2);
  const vm = snapshot(key);
  expect(vm.feed.some((f) => f.feed_type === "system_message")).toBe(false);
  expect(vm.sessionStatus).toBe("completed");
});

test("a Stop that races the engine's acceptance settles nothing before the cancel answered", async () => {
  const { output, snapshot } = vmOutput();
  const key = "activity-stop-races-accept";
  let stopped = false;
  let nonce: string | undefined;
  const { engine } = busyEngine(0, async (o) => {
    o.onEvent(sync(false, 0));
    // The engine took the message before the Stop reached it: its own echo,
    // reply and end arrive while the cancel is still out.
    await waitFor(() => stopped);
    reply(o, nonce, 1);
    await untilAborted(o);
  });
  engine.sendMessage = ((
    _id: string,
    _text: string,
    o?: { nonce?: string; signal?: AbortSignal },
  ) => {
    nonce = o?.nonce;
    return new Promise((_resolve, reject) => {
      o?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  }) as typeof engine.sendMessage;

  const turn = streamTurn(engine, "Houston/Bo", key, "hi", output, registry, {
    tuning: fast,
  });
  await waitFor(() => nonce !== undefined);
  const finish = registry.stopUnsent(streamKey("Houston/Bo", key));
  stopped = true;
  await new Promise((r) => setTimeout(r, 100));
  expect(snapshot(key).sessionStatus).toBe("running");
  finish?.();
  await turn;

  const vm = snapshot(key);
  expect(vm.boardStatus).toBe("needs_you");
  expect(vm.feed.some((f) => f.data === STOPPED_BY_USER)).toBe(true);
});
