/**
 * One attempt at the live-view stream: watches it for silence, and sorts how
 * it ended into what the connection does next. Every exit aborts the request,
 * so a stream given up on never keeps its connection open.
 */

import type { BrowserLiveEvent, BrowserLiveLayout } from "@houston/wire-types";
import type { Clock } from "../../ports";

/** The runtime heartbeats every 15 s; this long without a byte is a dead stream. */
export const BROWSER_LIVE_IDLE_MS = 45_000;

export interface BrowserLiveWatchOptions {
  viewer: string;
  layout: BrowserLiveLayout;
  /** The hand-off a reconnect is for; undefined before the first status. */
  handoff: string | undefined;
  signal: AbortSignal;
  onEvent: (event: BrowserLiveEvent) => void;
  onActivity?: () => void;
  onMalformed?: (error: unknown) => void;
}

/**
 * `cut`: the stream closed, went silent, or dropped after it answered 200 (a
 * mid-body read error such as Chromium's "network error" or Firefox's "Error
 * in body stream" is the connection, never an answer). `refused`: it failed
 * before any byte, so the error is the engine's answer to classify.
 * `malformed`: a data line that is not JSON.
 */
export type LiveStreamEnd =
  | { kind: "cut" }
  | { kind: "refused"; error: unknown }
  | { kind: "malformed"; error: unknown };

export interface LiveStreamAttempt {
  watch(options: BrowserLiveWatchOptions): Promise<void>;
  viewer: string;
  layout: BrowserLiveLayout;
  handoff: string | undefined;
  clock: Clock;
  onEvent(event: BrowserLiveEvent): void;
  onMalformed(error: unknown): void;
  /** Not called once the returned `stop` ran. */
  onEnd(end: LiveStreamEnd): void;
}

/** Starts the attempt; the returned function stops it silently. */
export function startLiveStream(attempt: LiveStreamAttempt): () => void {
  const { clock } = attempt;
  const controller = new AbortController();
  let live = true;
  let opened = false;
  let idle: number | null = null;
  const stop = () => {
    live = false;
    if (idle !== null) clock.clearTimeout(idle);
    idle = null;
    controller.abort();
  };
  const finish = (end: LiveStreamEnd) => {
    if (!live) return;
    stop();
    attempt.onEnd(end);
  };
  const armIdle = () => {
    if (idle !== null) clock.clearTimeout(idle);
    idle = clock.setTimeout(
      () => finish({ kind: "cut" }),
      BROWSER_LIVE_IDLE_MS,
    );
  };
  armIdle();
  attempt
    .watch({
      viewer: attempt.viewer,
      layout: attempt.layout,
      handoff: attempt.handoff,
      signal: controller.signal,
      onEvent: (event) => {
        if (live) attempt.onEvent(event);
      },
      onActivity: () => {
        if (!live) return;
        opened = true;
        armIdle();
      },
      onMalformed: (error) => {
        if (live) attempt.onMalformed(error);
      },
    })
    .then(
      () => finish({ kind: "cut" }),
      (error: unknown) => {
        if (error instanceof SyntaxError)
          return finish({ kind: "malformed", error });
        finish(opened ? { kind: "cut" } : { kind: "refused", error });
      },
    )
    .finally(stop);
  return stop;
}
