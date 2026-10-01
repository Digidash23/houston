import type { ProviderError, WireEvent } from "@houston/runtime-client";
import type { HarnessSession } from "../backends/types";
import { createStallWatchdog, isAbortEcho } from "../session/stall-watchdog";

/**
 * The standing server's model-stream stall watchdog (session/stall-watchdog.ts,
 * armed by exec-turn.ts) around one pooled prompt. Without it a provider
 * stream that goes silent resolves neither success nor error, and the turn
 * holds its sandbox and its claim until the sandbox itself is reaped.
 *
 * Same rules as the pod: armed for the model round-trip only, reset by every
 * wire event and by the backend's raw liveness feed (a tool call's streamed
 * input is wire-silent), suspended while a tool runs. On a trip it aborts the
 * session; the caller then turns the contentless turn into the typed
 * "stopped responding" card, and pi's echo of that abort is dropped.
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
  conversationId: string;
  turnId: string;
}): TurnStallGuard {
  let stalled = false;
  const seconds = Math.round(input.timeoutMs / 1000);
  const watchdog = createStallWatchdog({
    timeoutMs: input.timeoutMs,
    onStall: () => {
      stalled = true;
      console.warn(
        `[turn] stall watchdog aborted the turn: no provider event for ${seconds}s (conversation=${input.conversationId} turn=${input.turnId})`,
      );
      void input.session.abort();
    },
  });
  const unsubLiveness = input.session.subscribeLiveness?.(() =>
    watchdog.touch(),
  );
  return {
    admit(event) {
      if (stalled && event.type === "provider_error" && isAbortEcho(event.data))
        return false;
      watchdog.onEvent(event);
      return true;
    },
    arm: () => watchdog.arm(),
    disarm() {
      watchdog.disarm();
      unsubLiveness?.();
    },
    stalled: () => stalled,
    failure: (provider) => ({
      kind: "provider_internal",
      provider,
      http_status: null,
      message: `The AI provider stopped responding (no response for ${seconds}s). Please try again.`,
    }),
  };
}
