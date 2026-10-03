import type { ProviderError, WireEvent } from "@houston/runtime-client";
import type { HarnessSession } from "../backends/types";
import {
  describeStall,
  firstResponseWindowMs,
  stallFailure,
} from "../session/stall-failure";
import {
  createStallWatchdog,
  isAbortEcho,
  type StallReason,
} from "../session/stall-watchdog";

/**
 * The standing server's model-stream stall watchdog (session/stall-watchdog.ts,
 * armed by exec-turn.ts) around one pooled prompt. Without it a provider
 * stream that goes silent, never answers, or loops holds the turn's sandbox
 * and its claim until the sandbox itself is reaped, and with it one slot of
 * the environment's sandbox cap.
 *
 * Same rules as the pod: armed for the model round-trip only, reset by every
 * wire event and by the backend's raw liveness feed (a tool call's streamed
 * input is wire-silent), suspended while a tool runs. On a trip it aborts the
 * session; the caller then settles the turn on the typed card for the trip
 * (`failure`), and pi's echo of that abort is dropped.
 */
export interface TurnStallGuard {
  /** Feed one wire event. False means drop it: our own abort, echoed back. */
  admit(event: WireEvent): boolean;
  arm(): void;
  /** Stop the clock and detach from the session. Idempotent. */
  disarm(): void;
  stalled(): boolean;
  /** The typed failure a stalled turn settles on. */
  failure(provider: string): ProviderError;
}

export function guardTurnStall(input: {
  session: HarnessSession;
  timeoutMs: number;
  /** The configured first-response window (stall-failure.ts exempts own servers). */
  firstResponseTimeoutMs: number;
  conversationId: string;
  turnId: string;
}): TurnStallGuard {
  let trip: { reason: StallReason; windowMs: number } | undefined;
  const watchdog = createStallWatchdog({
    timeoutMs: input.timeoutMs,
    firstResponseMs: (provider) =>
      firstResponseWindowMs(provider, input.firstResponseTimeoutMs),
    onStall: (reason, windowMs) => {
      trip = { reason, windowMs };
      console.warn(
        `[turn] stall watchdog aborted the turn: ${describeStall(reason, windowMs)} (conversation=${input.conversationId} turn=${input.turnId})`,
      );
      void input.session.abort();
    },
  });
  const unsubLiveness = input.session.subscribeLiveness?.(() =>
    watchdog.touch(),
  );
  const unsubPhase = input.session.subscribeModelPhase?.((phase) =>
    watchdog.onPhase(phase),
  );
  return {
    admit(event) {
      if (trip && event.type === "provider_error" && isAbortEcho(event.data))
        return false;
      watchdog.onEvent(event);
      return true;
    },
    arm: () => watchdog.arm(),
    disarm() {
      watchdog.disarm();
      unsubLiveness?.();
      unsubPhase?.();
    },
    stalled: () => trip !== undefined,
    failure: (provider) =>
      stallFailure(
        trip?.reason ?? "silent",
        trip?.windowMs ?? input.timeoutMs,
        provider,
      ),
  };
}
