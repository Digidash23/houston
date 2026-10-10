/**
 * One open live view of a browser hand-off: the frame stream down (reconnected
 * on drops, given up as `lost` after its retries) and the input batches up.
 *
 * It receives the module's `watch` and `input` operations as functions rather
 * than a client: a handed-in function is not a route hop, so each live-view
 * route keeps exactly one SDK method (`browser.watch`, `browser.input`).
 */

import type {
  BrowserLiveEvent,
  BrowserLiveInputAnswer,
  BrowserLiveInputRequest,
  BrowserLiveLayout,
} from "@houston/wire-types";
import type { Clock } from "../../ports";
import { createInputBatcher } from "./input-batcher";
import { classifyLiveFailure } from "./live-failure";
import type {
  BrowserLiveConnection,
  BrowserLiveConnectionState,
  BrowserLiveHandlers,
} from "./types";

/** Reconnect pauses; past the last attempt the connection is `lost`. */
export const BROWSER_LIVE_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
export const BROWSER_LIVE_MAX_ATTEMPTS = 8;
/** The runtime heartbeats every 15 s; this long without a byte is a dead stream. */
export const BROWSER_LIVE_IDLE_MS = 45_000;

export interface BrowserLiveWatchOptions {
  viewer: string;
  layout: BrowserLiveLayout;
  signal: AbortSignal;
  onEvent: (event: BrowserLiveEvent) => void;
  onActivity?: () => void;
}

export interface BrowserLiveConnectionDeps {
  viewer: string;
  layout: BrowserLiveLayout;
  watch(options: BrowserLiveWatchOptions): Promise<void>;
  input(request: BrowserLiveInputRequest): Promise<BrowserLiveInputAnswer>;
  clock: Clock;
  isTransport(err: unknown): boolean;
  handlers: BrowserLiveHandlers;
}

type Ended = Extract<BrowserLiveConnectionState, { kind: "ended" }>;

export function openBrowserLiveConnection(
  deps: BrowserLiveConnectionDeps,
): BrowserLiveConnection {
  const { handlers, clock } = deps;
  let state: BrowserLiveConnectionState = { kind: "connecting" };
  let attempt = 0;
  let closed = false;
  let stream: AbortController | null = null;
  let idleTimer: number | null = null;
  let reconnectTimer: number | null = null;

  const setState = (next: BrowserLiveConnectionState) => {
    state = next;
    handlers.onConnection(next);
  };
  const clearTimers = () => {
    if (idleTimer !== null) clock.clearTimeout(idleTimer);
    if (reconnectTimer !== null) clock.clearTimeout(reconnectTimer);
    idleTimer = reconnectTimer = null;
  };
  const stop = () => {
    clearTimers();
    stream?.abort();
    stream = null;
    batcher.stop();
  };
  const end = (reason: Ended["reason"]) => {
    if (closed || state.kind === "ended") return;
    stop();
    setState({ kind: "ended", reason });
  };

  const batcher = createInputBatcher({
    viewer: deps.viewer,
    post: deps.input,
    clock,
    isTransport: deps.isTransport,
    onAnswer: (answer) => {
      if (answer.refused) handlers.onRefused(answer.refused);
      if (answer.state !== "waiting") end(answer.state);
    },
    onEnded: (failure) => end(failure.reason),
    onUnexpected: handlers.onUnexpected,
  });

  const onEvent = (event: BrowserLiveEvent) => {
    if (closed || state.kind === "ended") return;
    if (state.kind !== "live") {
      attempt = 0;
      setState({ kind: "live" });
    }
    if (event.type === "frame") {
      handlers.onFrame(event);
      batcher.ack(event.seq);
    } else if (event.type === "page") {
      handlers.onPage({ url: event.url, title: event.title });
    } else {
      const { state: handoff, text, expiresAt } = event;
      handlers.onStatus({ state: handoff, text, expiresAt });
      if (handoff !== "waiting") end(handoff);
    }
  };

  const scheduleReconnect = () => {
    if (closed || state.kind === "ended") return;
    attempt += 1;
    if (attempt > BROWSER_LIVE_MAX_ATTEMPTS) {
      // Queued input stays: `retry()` picks the same hand-off back up.
      clearTimers();
      stream = null;
      setState({ kind: "lost" });
      return;
    }
    setState({ kind: "reconnecting", attempt });
    const pause =
      BROWSER_LIVE_BACKOFF_MS[
        Math.min(attempt - 1, BROWSER_LIVE_BACKOFF_MS.length - 1)
      ];
    reconnectTimer = clock.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, pause);
  };

  const connect = () => {
    if (closed || state.kind === "ended") return;
    const controller = new AbortController();
    stream = controller;
    let idle = false;
    const armIdle = () => {
      if (idleTimer !== null) clock.clearTimeout(idleTimer);
      idleTimer = clock.setTimeout(() => {
        idle = true;
        controller.abort();
      }, BROWSER_LIVE_IDLE_MS);
    };
    armIdle();
    deps
      .watch({
        viewer: deps.viewer,
        layout: deps.layout,
        signal: controller.signal,
        onEvent,
        onActivity: armIdle,
      })
      .then(
        () => {
          // A stream that closed without a terminal status was cut, not ended.
          if (stream === controller) scheduleReconnect();
        },
        (err: unknown) => {
          if (stream !== controller) return;
          if (idle) return scheduleReconnect();
          const failure = classifyLiveFailure(err, deps.isTransport);
          if (failure.kind === "ended") return end(failure.reason);
          if (failure.kind === "unexpected") handlers.onUnexpected(err);
          scheduleReconnect();
        },
      )
      .finally(() => {
        if (stream === controller && idleTimer !== null) {
          clock.clearTimeout(idleTimer);
          idleTimer = null;
        }
      });
  };

  setState({ kind: "connecting" });
  connect();

  return {
    send: (event) => batcher.send(event),
    finish: (outcome) => batcher.finish(outcome),
    retry() {
      if (closed || state.kind !== "lost") return;
      attempt = 0;
      setState({ kind: "connecting" });
      connect();
    },
    close() {
      if (closed) return;
      closed = true;
      stop();
    },
  };
}
