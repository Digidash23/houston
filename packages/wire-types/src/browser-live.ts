/**
 * The browser hand-off wire shapes: while the agent's `browser` tool waits on
 * a `handoff`, the person drives the same page through a live view. Frames come
 * down an SSE stream (`BROWSER_LIVE_REST`), input goes up in POST batches
 * (`BROWSER_INPUT_REST`). Both are runtime-proxy members under
 * `/agents/:agentId/`, served by standing engines only.
 */

/** Per-agent rests under `/agents/:agentId/` (runtime-proxy members, STANDING only). */
export const BROWSER_LIVE_REST = "conversations/:conversationId/browser/live";
export const BROWSER_INPUT_REST = "conversations/:conversationId/browser/input";

export const BROWSER_HANDOFF_STATES = [
  "waiting",
  "done",
  "cancelled",
  "expired",
] as const;
export type BrowserHandoffState = (typeof BROWSER_HANDOFF_STATES)[number];
export type BrowserHandoffEnd = Exclude<BrowserHandoffState, "waiting">;

/** How long the person has from the moment the agent hands over. */
export const BROWSER_HANDOFF_LIMIT_MS = 10 * 60_000;

/** The `browser` tool's handoff refusals, carried in tool_end content as `ERROR <code>: …`. */
export const BROWSER_HANDOFF_FAILURES = [
  "handoff_cancelled",
  "handoff_expired",
  "handoff_unavailable",
] as const;
export type BrowserHandoffFailure = (typeof BROWSER_HANDOFF_FAILURES)[number];

export type BrowserLiveLayout = "desktop" | "phone";
/** GET query: `viewer` (required, /^[A-Za-z0-9_-]{8,64}$/), `layout` (default desktop). */
export const BROWSER_LIVE_VIEWER = /^[A-Za-z0-9_-]{8,64}$/;

// server → client (SSE `data:` JSON; `type` is the discriminant)
export interface BrowserLiveFrame {
  type: "frame";
  seq: number;
  /** Base64 JPEG, no data-URL prefix. */
  jpeg: string;
  width: number;
  height: number;
}
export interface BrowserLivePage {
  type: "page";
  url: string;
  title: string;
}
export interface BrowserLiveStatus {
  type: "status";
  state: BrowserHandoffState;
  text: string;
  /** Epoch ms the hand-off expires at. */
  expiresAt: number;
}
export type BrowserLiveEvent =
  | BrowserLiveFrame
  | BrowserLivePage
  | BrowserLiveStatus;

// client → server (POST body)
export const BROWSER_LIVE_KEYS = [
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowLeft",
  "ArrowUp",
  "ArrowRight",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
] as const;
export type BrowserLiveKey = (typeof BROWSER_LIVE_KEYS)[number];
/** CDP modifier bits. */
export const BROWSER_LIVE_MODIFIER = {
  alt: 1,
  ctrl: 2,
  meta: 4,
  shift: 8,
} as const;

export type BrowserLiveMouseAction = "move" | "down" | "up" | "click";

/** x, y are 0..1 of the frame; the runtime scales by the page's own viewport. */
export type BrowserLiveInput =
  | {
      type: "mouse";
      action: BrowserLiveMouseAction;
      x: number;
      y: number;
      buttons?: 0 | 1;
      clickCount?: 1 | 2 | 3;
    }
  | { type: "wheel"; x: number; y: number; dx: number; dy: number }
  | { type: "key"; key: BrowserLiveKey; modifiers?: number }
  | { type: "text"; text: string }
  | { type: "navigate"; url: string }
  | { type: "back" };

export const BROWSER_LIVE_MAX_EVENTS = 64;
export const BROWSER_LIVE_MAX_TEXT = 10_000;
export const BROWSER_LIVE_MAX_BODY_BYTES = 64 * 1024;
/** Unacked frames the runtime keeps in flight per viewer. */
export const BROWSER_LIVE_FRAME_WINDOW = 2;

export interface BrowserLiveInputRequest {
  events?: BrowserLiveInput[];
  /** The highest frame `seq` this viewer has received. */
  ack?: { viewer: string; seq: number };
  finish?: "done" | "cancel";
}
export interface BrowserLiveInputAnswer {
  state: BrowserHandoffState;
  /** A `navigate` the URL policy refused; the rest of the batch still ran. */
  refused?: "url_refused";
}

/** Error bodies `{ error: code, code, state? }`. */
export const BROWSER_LIVE_REFUSALS = [
  "no_handoff",
  "handoff_ended",
  "not_handoff_owner",
  "invalid_input",
] as const;
export type BrowserLiveRefusal = (typeof BROWSER_LIVE_REFUSALS)[number];
