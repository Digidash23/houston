import type { FirstResponse } from "@houston/sdk";
import { reportAdapterError } from "./error-sink";

/**
 * The first response of every turn this adapter sends (the SDK's
 * `FirstResponse`: the turn's first visible text, or how it ended without
 * one), for the app's latency spans. A dedicated listener set rather than a
 * bus event: it is a measurement, not a domain change any query reacts to.
 */
export interface FirstResponseEvent {
  agentPath: string;
  sessionKey: string;
  response: FirstResponse;
}

type Listener = (event: FirstResponseEvent) => void;

const listeners = new Set<Listener>();

/** Hear every sent turn's first response. Returns the unsubscribe. */
export function subscribeFirstResponses(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Deliver one report to every listener; a throwing listener never stops the rest. */
export function publishFirstResponse(event: FirstResponseEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      reportAdapterError("first_response_listener", e);
    }
  }
}
