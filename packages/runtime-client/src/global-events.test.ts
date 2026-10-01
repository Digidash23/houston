import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";
import { streamGlobalEvents } from "./global-events";
import { WAKE_SETTLE_MS } from "./global-events-contract";

/**
 * The global-events loop against a REAL local SSE server: each test scripts the
 * server per connection (frames, drops, refusals) and asserts what the caller
 * observes (parsed frames, reconnect count, the auth/query each attempt carried,
 * and which hooks fired). Mirrors `resume.test.ts`'s harness.
 */

type Conn = {
  res: ServerResponse;
  query: URLSearchParams;
  send(obj: unknown): void;
  raw(text: string): void;
};
type Harness = { baseUrl: string; connections: Conn[] };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function startServer(
  script: (conn: Conn, index: number) => void,
  statusFor?: (index: number) => number,
): Promise<Harness> {
  const connections: Conn[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const index = connections.length;
    const status = statusFor?.(index) ?? 200;
    if (status !== 200) {
      connections.push({
        res,
        query: url.searchParams,
        send: () => {},
        raw: () => {},
      });
      res.writeHead(status, { "Content-Type": "text/plain" });
      res.end("refused");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": connected\n\n");
    const conn: Conn = {
      res,
      query: url.searchParams,
      send: (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`),
      raw: (text) => res.write(text),
    };
    connections.push(conn);
    script(conn, index);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, connections };
}

/** A near-instant reconnect wait that still respects abort (no fixed 1500ms). */
const instant = (_ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, 1);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

test("reconnects after each drop; onConnect fires per connect; onEvent gets parsed frames", async () => {
  const h = await startServer((conn, i) => {
    conn.send({ type: "AgentsChanged", n: i });
    conn.res.end(); // server closes → drives a reconnect
  });
  const ac = new AbortController();
  const events: unknown[] = [];
  let connects = 0;

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    onConnect: () => connects++,
    onEvent: (d) => {
      events.push(d);
      if (events.length === 2) ac.abort();
    },
  });

  expect(connects).toBe(2);
  expect(events).toEqual([
    { type: "AgentsChanged", n: 0 },
    { type: "AgentsChanged", n: 1 },
  ]);
});

test("url() is re-invoked per connect so a rotated query token stays current", async () => {
  let token = "t0";
  const h = await startServer((conn) => conn.res.end());
  const ac = new AbortController();
  let connects = 0;

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events?token=${token}`,
    fetch,
    signal: ac.signal,
    sleep: (ms, signal) => {
      token = "t1"; // a refresh lands between attempts
      return instant(ms, signal);
    },
    onConnect: () => {
      connects++;
      if (connects === 2) ac.abort();
    },
    onEvent: () => {},
  });

  expect(h.connections.map((c) => c.query.get("token"))).toEqual(["t0", "t1"]);
});

test("a 401 with onUnauthorized notifies, does NOT read/connect, then reconnects", async () => {
  const h = await startServer(
    (conn) => {
      conn.send({ type: "AgentsChanged" });
      conn.res.end();
    },
    (i) => (i === 0 ? 401 : 200),
  );
  const ac = new AbortController();
  let unauthorized = 0;
  let connects = 0;
  const errors: unknown[] = [];
  const events: unknown[] = [];

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    onUnauthorized: () => unauthorized++,
    onConnect: () => connects++,
    onError: (e) => errors.push(e),
    onEvent: (d) => {
      events.push(d);
      ac.abort();
    },
  });

  expect(unauthorized).toBe(1);
  expect(connects).toBe(1); // the refused attempt is not a connect
  expect(errors).toEqual([]); // a handled 401 is not an error
  expect(events).toEqual([{ type: "AgentsChanged" }]);
});

test("a 401 without onUnauthorized is a plain non-ok drop routed through onError", async () => {
  const h = await startServer(
    (conn) => {
      conn.send({ type: "x" });
      conn.res.end();
    },
    (i) => (i === 0 ? 401 : 200),
  );
  const ac = new AbortController();
  const errors: unknown[] = [];

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    onError: (e) => errors.push(e),
    onEvent: () => ac.abort(),
  });

  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toContain("/v1/events 401");
});

test("a malformed frame is swallowed (tolerant read); later frames still arrive", async () => {
  const h = await startServer((conn) => {
    conn.raw("data: {bad json\n\n");
    conn.send({ type: "AgentsChanged" });
    conn.res.end();
  });
  const ac = new AbortController();
  const events: unknown[] = [];

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    onEvent: (d) => {
      events.push(d);
      ac.abort();
    },
  });

  expect(events).toEqual([{ type: "AgentsChanged" }]);
});

test("a clean 200 close reconnects silently — no onError", async () => {
  const h = await startServer((conn, i) => {
    if (i === 0) {
      conn.res.end(); // clean close, delivered no frame
    } else {
      conn.send({ type: "AgentsChanged" });
      conn.res.end();
    }
  });
  const ac = new AbortController();
  const errors: unknown[] = [];
  const events: unknown[] = [];

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    onError: (e) => errors.push(e),
    onEvent: (d) => {
      events.push(d);
      ac.abort();
    },
  });

  expect(errors).toEqual([]);
  expect(events).toEqual([{ type: "AgentsChanged" }]);
  expect(h.connections).toHaveLength(2);
});

test("aborting the signal stops the loop after the current attempt", async () => {
  const h = await startServer(() => {
    /* stay open and silent */
  });
  const ac = new AbortController();
  let connects = 0;

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    onConnect: () => {
      connects++;
      ac.abort();
    },
    onEvent: () => {},
  });

  expect(connects).toBe(1);
  expect(h.connections).toHaveLength(1);
});

/**
 * Liveness. The global feed is the app's ONLY reactivity channel, so the loop
 * has exactly one unacceptable outcome: a tab that holds a connection nothing
 * is coming through while the host is healthy. These pin the three ways that
 * used to happen — a wedged read, an outage outlasting a fixed retry cadence,
 * and a machine that slept through both.
 */

/** A `sleep` that only ever ends when its signal aborts (never on time). */
const untilPoked = (_ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

test("a silent connection is force-reconnected by the idle watchdog", async () => {
  // Connection 0 stays open and says nothing — the half-open socket a slept
  // laptop or a moved network leaves behind. Without the watchdog `read()`
  // never settles and the loop never iterates again.
  const h = await startServer((conn, i) => {
    if (i > 0) conn.send({ type: "AgentsChanged" });
  });
  const ac = new AbortController();
  const errors: unknown[] = [];
  const events: unknown[] = [];

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    idleTimeoutMs: 60,
    onError: (e) => errors.push(e),
    onEvent: (d) => {
      events.push(d);
      ac.abort();
    },
  });

  expect(events).toEqual([{ type: "AgentsChanged" }]);
  expect(h.connections.length).toBeGreaterThanOrEqual(2);
  expect(String(errors[0])).toContain("stalled");
});

test("backoff grows per failed attempt, is capped, and resets once bytes flow", async () => {
  const caps: number[] = [];
  const h = await startServer(
    (conn) => {
      conn.send({ type: "AgentsChanged" });
      conn.res.end();
    },
    (i) => (i < 3 ? 503 : 200),
  );
  const ac = new AbortController();
  let events = 0;

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    maxDelayMs: 4000,
    jitter: (capMs) => {
      caps.push(capMs);
      return 0;
    },
    onEvent: () => {
      if (++events === 2) ac.abort();
    },
  });

  // 1500 → 3000 → 4000 (capped), then the 4th attempt delivers and the cap
  // drops back to the initial delay: a healthy stream that drops again must
  // not inherit the outage's backoff.
  expect(caps).toEqual([1500, 3000, 4000, 1500]);
});

test("never gives up: an outage longer than any retry budget still recovers", async () => {
  const h = await startServer(
    (conn) => {
      conn.send({ type: "AgentsChanged" });
      conn.res.end();
    },
    (i) => (i < 12 ? 503 : 200),
  );
  const ac = new AbortController();
  const events: unknown[] = [];

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    onError: () => {},
    onEvent: (d) => {
      events.push(d);
      ac.abort();
    },
  });

  expect(events).toEqual([{ type: "AgentsChanged" }]);
  expect(h.connections).toHaveLength(13);
});

test("wake cuts a pending backoff short and is torn down with the loop", async () => {
  const h = await startServer(
    (conn) => {
      conn.send({ type: "AgentsChanged" });
      conn.res.end();
    },
    (i) => (i === 0 ? 503 : 200),
  );
  const ac = new AbortController();
  let retryNow: (() => void) | undefined;
  let wakeTornDown = false;
  const events: unknown[] = [];

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: untilPoked, // the wait ends ONLY if something wakes it
    wake: (fn) => {
      retryNow = fn;
      return () => {
        wakeTornDown = true;
      };
    },
    onError: () => setTimeout(() => retryNow?.(), 0),
    onEvent: (d) => {
      events.push(d);
      ac.abort();
    },
  });

  expect(events).toEqual([{ type: "AgentsChanged" }]);
  expect(wakeTornDown).toBe(true);
});

test("wake leaves a healthy connection alone", async () => {
  const h = await startServer((conn) => {
    conn.send({ type: "AgentsChanged" });
  }); // stays open — a live stream, not a wedged one
  const ac = new AbortController();
  let retryNow: (() => void) | undefined;

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    wake: (fn) => {
      retryNow = fn;
      return () => {};
    },
    onEvent: () => {
      retryNow?.(); // bytes just arrived: nothing to recover
      ac.abort();
    },
  });

  expect(h.connections).toHaveLength(1);
});

/**
 * A hidden page does not run on the wall clock. A backgrounded desktop window
 * or browser tab is woken once every minute or more, and at each wake its
 * timers can run BEFORE the heartbeat bytes the network queued meanwhile. A
 * watchdog that reads that wall-clock gap as silence tears down a healthy
 * stream at every wake, and every reconnect makes the app re-read everything
 * it shows. Staging logged exactly that: one client's stream lived 60 s, sat
 * closed for 60 s, and reopened, all day.
 */

/** A clock that runs `rate` times faster than real time: every watchdog tick
 *  then lands long after the one before it, as in a page the OS keeps asleep. */
function sleepingPageClock(rate: number): () => number {
  const start = Date.now();
  return () => start + (Date.now() - start) * rate;
}

test("a heartbeating stream survives a page whose timers only run after long sleeps", async () => {
  const h = await startServer((conn) => {
    const beat = setInterval(() => conn.raw(": hb\n\n"), 10);
    conn.res.on("close", () => clearInterval(beat));
  });
  const ac = new AbortController();
  const errors: unknown[] = [];
  let connects = 0;

  const run = streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    idleTimeoutMs: 60,
    now: sleepingPageClock(1000),
    onConnect: () => connects++,
    onError: (e) => errors.push(e),
    onEvent: () => {},
  });
  await new Promise((r) => setTimeout(r, 300));
  ac.abort();
  await run;

  expect(errors).toEqual([]);
  expect(connects).toBe(1);
});

/** A clock the test can push forward, as if the page had slept that long. */
function skewableClock() {
  let skew = 0;
  return {
    now: () => Date.now() + skew,
    sleep: (ms: number) => {
      skew += ms;
    },
  };
}

test("a wake gives a just-woken page time to read the heartbeats it slept through", async () => {
  const clock = skewableClock();
  let retryNow: (() => void) | undefined;
  const h = await startServer((conn) => {
    // The page reads `: connected`, sleeps 30 s with nothing read, then the
    // window becomes visible: the wake arrives before the bytes queued
    // meanwhile.
    setTimeout(() => {
      clock.sleep(30_000);
      retryNow?.();
      conn.raw(": hb\n\n");
    }, 20);
  });
  const ac = new AbortController();
  const errors: unknown[] = [];

  const run = streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    now: clock.now,
    wake: (fn) => {
      retryNow = fn;
      return () => {};
    },
    onError: (e) => errors.push(e),
    onEvent: () => {},
  });
  await new Promise((r) => setTimeout(r, WAKE_SETTLE_MS + 300));
  ac.abort();
  await run;

  expect(errors).toEqual([]);
  expect(h.connections).toHaveLength(1);
});

test("a wake still replaces a socket that died while the page slept", async () => {
  const clock = skewableClock();
  let retryNow: (() => void) | undefined;
  const h = await startServer((conn, i) => {
    if (i > 0) {
      conn.send({ type: "AgentsChanged" });
      return;
    }
    // Nothing ever arrives on this socket after `: connected`.
    setTimeout(() => {
      clock.sleep(30_000);
      retryNow?.();
    }, 20);
  });
  const ac = new AbortController();
  const errors: unknown[] = [];

  await streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    now: clock.now,
    wake: (fn) => {
      retryNow = fn;
      return () => {};
    },
    onError: (e) => errors.push(e),
    onEvent: () => ac.abort(),
  });

  expect(h.connections).toHaveLength(2);
  expect(String(errors[0])).toContain("stalled");
});

test("a wake whose settle check the page slept through gives the backlog another chance", async () => {
  const clock = skewableClock();
  let retryNow: (() => void) | undefined;
  const h = await startServer((conn) => {
    // The window flashes visible and the page goes back to sleep before the
    // settle check runs; the heartbeats it held land after that late check.
    setTimeout(() => {
      retryNow?.();
      clock.sleep(60_000);
    }, 20);
    setTimeout(() => conn.raw(": hb\n\n"), WAKE_SETTLE_MS + 200);
  });
  const ac = new AbortController();
  const errors: unknown[] = [];

  const run = streamGlobalEvents({
    url: () => `${h.baseUrl}/v1/events`,
    fetch,
    signal: ac.signal,
    sleep: instant,
    now: clock.now,
    wake: (fn) => {
      retryNow = fn;
      return () => {};
    },
    onError: (e) => errors.push(e),
    onEvent: () => {},
  });
  await new Promise((r) => setTimeout(r, 2 * WAKE_SETTLE_MS + 500));
  ac.abort();
  await run;

  expect(errors).toEqual([]);
  expect(h.connections).toHaveLength(1);
});
