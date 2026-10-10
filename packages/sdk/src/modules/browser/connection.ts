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
import { type BrowserLiveWatchOptions, startLiveStream } from "./live-stream";

export {
  BROWSER_LIVE_IDLE_MS,
  type BrowserLiveWatchOptions,
} from "./live-stream";

import type {
  BrowserLiveConnection,
  BrowserLiveConnectionState,
  BrowserLiveHandlers,
} from "./types";

/** Reconnect pauses; past the last attempt the connection is `lost`. */
export const BROWSER_LIVE_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
export const BROWSER_LIVE_MAX_ATTEMPTS = 8;
/**
 * A stream must stay up this long before the reconnect count starts over: the
 * runtime sends a status (and a frame) on every connect, so "it said
 * something" proves nothing about a stream that then dies at once.
 */
export const BROWSER_LIVE_HEALTHY_MS = 10_000;

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
  let layout = deps.layout;
  let state: BrowserLiveConnectionState = { kind: "connecting" };
  let attempt = 0;
  let closed = false;
  let stopStream: (() => void) | null = null;
  let reconnectTimer: number | null = null;
  let healthyTimer: number | null = null;
  // A drifting stream says so on every reconnect: report it once.
  let malformedReported = false;
  const reportMalformed = (err: unknown) => {
    if (malformedReported) return;
    malformedReported = true;
    handlers.onUnexpected(err);
  };

  const setState = (next: BrowserLiveConnectionState) => {
    state = next;
    handlers.onConnection(next);
  };
  const dropStream = () => {
    if (reconnectTimer !== null) clock.clearTimeout(reconnectTimer);
    if (healthyTimer !== null) clock.clearTimeout(healthyTimer);
    reconnectTimer = healthyTimer = null;
    stopStream?.();
    stopStream = null;
  };
  const end = (reason: Ended["reason"]) => {
    if (closed || state.kind === "ended") return;
    dropStream();
    batcher.stop("answered");
    setState({ kind: "ended", reason });
  };
  const gone = () => closed || state.kind === "ended";

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
    if (gone()) return;
    if (state.kind !== "live") {
      setState({ kind: "live" });
      healthyTimer = clock.setTimeout(() => {
        healthyTimer = null;
        attempt = 0;
      }, BROWSER_LIVE_HEALTHY_MS);
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
    if (gone()) return;
    dropStream();
    attempt += 1;
    // Queued input stays through `lost`: `retry()` picks the same hand-off up.
    if (attempt > BROWSER_LIVE_MAX_ATTEMPTS) return setState({ kind: "lost" });
    setState({ kind: "reconnecting", attempt });
    const steps = BROWSER_LIVE_BACKOFF_MS;
    reconnectTimer = clock.setTimeout(
      () => {
        reconnectTimer = null;
        connect();
      },
      steps[Math.min(attempt - 1, steps.length - 1)],
    );
  };

  const connect = () => {
    if (gone()) return;
    stopStream = startLiveStream({
      watch: deps.watch,
      viewer: deps.viewer,
      layout,
      clock,
      onEvent,
      onMalformed: reportMalformed,
      onEnd: (streamEnd) => {
        stopStream = null;
        if (streamEnd.kind === "malformed") reportMalformed(streamEnd.error);
        if (streamEnd.kind === "refused") {
          const failure = classifyLiveFailure(
            streamEnd.error,
            deps.isTransport,
          );
          if (failure.kind === "ended") return end(failure.reason);
          if (failure.kind === "unexpected")
            handlers.onUnexpected(streamEnd.error);
        }
        // A stream that closed without a terminal status was cut, not ended.
        scheduleReconnect();
      },
    });
  };

  setState({ kind: "connecting" });
  connect();

  return {
    send: (event) => batcher.send(event),
    finish: (outcome) => batcher.finish(outcome),
    setLayout(next) {
      if (next === layout) return;
      layout = next;
      // Lost or waiting out a pause: the next connect already takes it.
      if (gone() || stopStream === null) return;
      dropStream();
      setState({ kind: "connecting" });
      connect();
    },
    retry() {
      if (closed || state.kind !== "lost") return;
      attempt = 0;
      setState({ kind: "connecting" });
      connect();
    },
    close() {
      if (closed) return;
      closed = true;
      dropStream();
      batcher.stop("abandoned");
    },
  };
}
