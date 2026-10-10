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
/**
 * GET query: `viewer` (required, /^[A-Za-z0-9_-]{8,64}$/), `layout` (default
 * desktop), and `handoff` (optional, {@link BROWSER_LIVE_HANDOFF}): the
 * hand-off the viewer is watching, once its first status named it.
 *
 * - No `handoff`: the chat's current hand-off (`404 no_handoff` when none).
 * - `handoff` names the current one: served as usual.
 * - `handoff` names an earlier one still retained (60 s after it ended): one
 *   terminal `status` of THAT hand-off, then the stream closes.
 * - `handoff` names one no longer known: `409 handoff_ended` (no `state`)
 *   while the chat has a newer hand-off, `404 no_handoff` when it has none.
 */
export const BROWSER_LIVE_VIEWER = /^[A-Za-z0-9_-]{8,64}$/;
/** A hand-off id as the runtime mints it (a UUID) and the client echoes it. */
export const BROWSER_LIVE_HANDOFF = /^[A-Za-z0-9_-]{8,64}$/;

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
  /**
   * This hand-off's unguessable id. A chat may hand over again after one
   * ends; the client stamps this id on everything it sends so nothing from an
   * earlier hand-off's view (a late Done, a retry) acts on a newer one.
   */
  handoffId: string;
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
/** The client's per-POST timeout for an input batch; a retry reuses its `batch`. */
export const BROWSER_LIVE_INPUT_TIMEOUT_MS = 15_000;

export interface BrowserLiveInputRequest {
  /**
   * The hand-off this request is for (its status's `handoffId`). One naming
   * any other hand-off than the chat's waiting one gets `409 handoff_ended`
   * (with that hand-off's `state` while it is retained) and changes nothing.
   * REQUIRED with `events`, `ack` or `finish` (`400 invalid_input` without it).
   */
  handoff?: string;
  events?: BrowserLiveInput[];
  /** The highest frame `seq` this viewer has received. */
  ack?: { viewer: string; seq: number };
  /**
   * Makes `events` idempotent across retries: `seq` starts at 1 and strictly
   * increases per viewer. The runtime remembers the highest seq it applied
   * per viewer; a request whose `seq` is not above it gets the current state
   * WITHOUT its events being applied again (its `ack` and `finish` still are).
   */
  batch?: { viewer: string; seq: number };
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
