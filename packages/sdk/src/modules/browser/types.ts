/**
 * The browser hand-off live view as a surface binds it: one
 * {@link BrowserLiveConnection} per open live view, reporting through
 * {@link BrowserLiveHandlers}. The wire shapes are `@houston/wire-types`'.
 */

import type {
  BrowserHandoffEnd,
  BrowserHandoffState,
  BrowserLiveFrame,
  BrowserLiveInput,
  BrowserLiveLayout,
} from "@houston/wire-types";

/**
 * `ended.reason`: how the hand-off ended (`done`/`cancelled`/`expired`),
 * `none` when there is no hand-off waiting in this chat (any more), and
 * `not_owner` when it belongs to another person. `lost` is the connection
 * giving up after its retries; `retry()` starts again.
 */
export type BrowserLiveConnectionState =
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "reconnecting"; attempt: number }
  | { kind: "lost" }
  | { kind: "ended"; reason: BrowserHandoffEnd | "none" | "not_owner" };

export interface BrowserLiveHandlers {
  onFrame(frame: BrowserLiveFrame): void;
  onPage(page: { url: string; title: string }): void;
  onStatus(status: {
    state: BrowserHandoffState;
    text: string;
    expiresAt: number;
  }): void;
  onConnection(state: BrowserLiveConnectionState): void;
  /** A `navigate` the URL policy refused; the hand-off goes on. */
  onRefused(code: "url_refused"): void;
  /** Not connectivity, not an expected refusal: the surface reports it. */
  onUnexpected(error: unknown): void;
}

export interface BrowserLiveConnection {
  /** Queue one input event; batched and sent in order. */
  send(event: BrowserLiveInput): void;
  /** Flushes queued input first; resolves once the hand-off answered (or had already ended). */
  finish(outcome: "done" | "cancel"): Promise<void>;
  /** Start again after `lost`. */
  retry(): void;
  /** Stops watching only; the hand-off keeps waiting. */
  close(): void;
}

export interface BrowserLiveConnectOptions {
  layout?: BrowserLiveLayout;
}
