/**
 * Strict parsers for the browser hand-off wire (`./browser-live`). The runtime
 * validates the input POST with the same parser the SDK uses to read the SSE
 * stream, so both ends throw on the same drift instead of guessing.
 */

import {
  BROWSER_HANDOFF_FAILURES,
  type BrowserHandoffFailure,
  type BrowserLiveEvent,
  type BrowserLiveInputAnswer,
} from "./browser-live";
import { count, finite, isState, record, text } from "./browser-live-fields";

export { parseBrowserLiveInputRequest } from "./browser-live-input-parse";

/** One SSE `data:` message, or a throw naming what is wrong with it. */
export function parseBrowserLiveEvent(value: unknown): BrowserLiveEvent {
  const body = record(value, "browser live event");
  switch (body.type) {
    case "frame": {
      const width = finite(body.width, "browser live frame width");
      const height = finite(body.height, "browser live frame height");
      if (width <= 0 || height <= 0)
        throw new Error("Invalid browser live frame size");
      const jpeg = text(body.jpeg, "browser live frame jpeg");
      if (!jpeg) throw new Error("Invalid browser live frame jpeg");
      return {
        type: "frame",
        seq: count(body.seq, "browser live frame seq"),
        jpeg,
        width,
        height,
      };
    }
    case "page":
      return {
        type: "page",
        url: text(body.url, "browser live page url"),
        title: text(body.title, "browser live page title"),
      };
    case "status":
      if (!isState(body.state))
        throw new Error("Invalid browser live status state");
      return {
        type: "status",
        state: body.state,
        text: text(body.text, "browser live status text"),
        expiresAt: count(body.expiresAt, "browser live status expiresAt"),
      };
    default:
      throw new Error("Invalid browser live event type");
  }
}

/** The input POST's `200` answer, or a throw. */
export function parseBrowserLiveInputAnswer(
  value: unknown,
): BrowserLiveInputAnswer {
  const body = record(value, "browser input answer");
  if (!isState(body.state))
    throw new Error("Invalid browser input answer state");
  if (body.refused !== undefined && body.refused !== "url_refused")
    throw new Error("Invalid browser input answer refusal");
  return {
    state: body.state,
    ...(body.refused === "url_refused" ? { refused: body.refused } : {}),
  };
}

const FAILURE_PATTERN = /\bERROR (handoff_[a-z]+):/;

/** The hand-off refusal a `browser` tool result carries, if any. */
export function browserHandoffFailureOf(
  content: string,
): BrowserHandoffFailure | null {
  const code = content.slice(0, 200).match(FAILURE_PATTERN)?.[1];
  return BROWSER_HANDOFF_FAILURES.includes(code as BrowserHandoffFailure)
    ? (code as BrowserHandoffFailure)
    : null;
}
