/**
 * What a failed live-view request means for the connection. One table for the
 * stream and the input POST, so the two never read the same answer apart.
 */

import {
  BROWSER_HANDOFF_STATES,
  type BrowserHandoffEnd,
} from "@houston/wire-types";
import type { BrowserLiveConnectionState } from "./types";

type EndReason = Extract<
  BrowserLiveConnectionState,
  { kind: "ended" }
>["reason"];

export type BrowserLiveFailure =
  /** The hand-off is over or not this person's: stop, say why. */
  | { kind: "ended"; reason: EndReason }
  /** No answer, an expired token, a server hiccup: try again. */
  | { kind: "transient" }
  /** A request the runtime refused as malformed, or no HTTP answer shape at all. */
  | { kind: "unexpected" };

function statusOf(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/** The `state` a `409 handoff_ended` body names, when it names a known end. */
function endedStateOf(err: unknown): BrowserHandoffEnd | "none" {
  const body = (err as { body?: unknown }).body;
  if (typeof body !== "string") return "none";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "none"; // a proxy's non-JSON 409 still means the hand-off ended
  }
  const state = (parsed as { state?: unknown } | null)?.state;
  return state !== "waiting" &&
    BROWSER_HANDOFF_STATES.includes(state as BrowserHandoffEnd)
    ? (state as BrowserHandoffEnd)
    : "none";
}

/** An input POST that got no answer within `BROWSER_LIVE_INPUT_TIMEOUT_MS`. */
export class BrowserLiveInputTimeout extends Error {
  constructor() {
    super("browser input POST timed out");
    this.name = "BrowserLiveInputTimeout";
  }
}

export function classifyLiveFailure(
  err: unknown,
  isTransport: (err: unknown) => boolean,
): BrowserLiveFailure {
  if (isTransport(err) || err instanceof BrowserLiveInputTimeout)
    return { kind: "transient" };
  const status = statusOf(err);
  if (status === null) return { kind: "unexpected" };
  if (status === 404) return { kind: "ended", reason: "none" };
  if (status === 403) return { kind: "ended", reason: "not_owner" };
  if (status === 409) return { kind: "ended", reason: endedStateOf(err) };
  // A 401 already reached the shared auth-expiry notifier: the SDK's auth
  // fetch reports every 401 with the token it carried (a module-level
  // `notifyExpired()` without that token is a no-op by design). Retrying here
  // is what picks the refreshed token up.
  if (status === 401 || status === 408 || status === 429 || status >= 500)
    return { kind: "transient" };
  // A connect that never got a response (the engine client's status 0) too.
  if (status === 0) return { kind: "transient" };
  return { kind: "unexpected" };
}
