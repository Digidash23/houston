// Dependency-free (the app's node:test runner drives it directly): the SDK's
// vocabulary through its subpath, the legacy copy classifier, the burst gate.
import {
  isSessionStatusOrigin,
  isTurnErrorClass,
  type SessionStatusOrigin,
  type TurnErrorClass,
  turnErrorDisposition,
} from "@houston/sdk/turns/turn-error-class";
import { classifyAnalyticsError } from "./analytics-error-kind.ts";
import { type BurstGate, createBurstGate } from "./error-burst.ts";

/** The `SessionStatus` HoustonEvent fields the failure analytics read. */
export interface SessionErrorData {
  agent_path: string;
  session_key: string;
  error: string | null;
  error_class?: string;
  origin?: string;
}

export interface SessionFailureEvent {
  event: "session_failed" | "app_error_shown";
  props: {
    source?: "session";
    error_kind: string;
    error_class?: TurnErrorClass;
    origin?: SessionStatusOrigin;
  };
}

/**
 * One `app_error_shown` per distinct problem per conversation per hour. A
 * repeat inside the window refreshes it (`createBurstGate`), so a run that
 * fails the same way every quarter hour is one shown error, not ninety-six a
 * day drowning the fleet's dashboard. `session_failed` is never collapsed:
 * every failed turn counts.
 */
export const SESSION_ERROR_SHOWN_WINDOW_MS = 60 * 60 * 1_000;

/**
 * The analytics for an `error` session status, from the SDK's typed class
 * rather than the chat copy (which hides every cause behind "Something went
 * wrong", so it only ever classified `unknown`). The SDK's disposition rules:
 * a turn the person stopped is no failure; a handled state (restart line,
 * busy notice, typed provider card) is a failed turn but not an error shown;
 * only an unexplained failure counts as `app_error_shown`. A status with no
 * class and no copy (an older emitter) counts nothing, as before.
 */
export function createSessionFailureTracker(
  gate: BurstGate = createBurstGate(SESSION_ERROR_SHOWN_WINDOW_MS),
): (data: SessionErrorData, now: number) => SessionFailureEvent[] {
  return (data, now) => {
    const cls = isTurnErrorClass(data.error_class)
      ? data.error_class
      : undefined;
    if (!cls && !data.error) return [];
    const disposition = cls ? turnErrorDisposition(cls) : "failure";
    if (disposition === "intended") return [];
    const props: SessionFailureEvent["props"] = {
      error_kind: classifyAnalyticsError(data.error ?? ""),
      ...(cls ? { error_class: cls } : {}),
      ...(isSessionStatusOrigin(data.origin) ? { origin: data.origin } : {}),
    };
    const events: SessionFailureEvent[] = [{ event: "session_failed", props }];
    if (disposition !== "failure") return events;
    const key = `${data.agent_path}\n${data.session_key}\n${cls ?? props.error_kind}`;
    if (gate.isFirst(key, now))
      events.push({
        event: "app_error_shown",
        props: { source: "session", ...props },
      });
    return events;
  };
}

export const sessionFailureEvents = createSessionFailureTracker();
