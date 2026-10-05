import type { SendAccepted } from "@houston/runtime-client";
import { computeBusyRefusal, SendBusyClock } from "./send-busy";
import {
  type ActiveStream,
  SEND_TURN_RUNNING_HOLD_MS,
  SEND_TURN_RUNNING_RETRY_DELAYS_MS,
  SEND_WAKE_RETRY_DELAYS_MS,
  type StreamRegistry,
  type StreamTuning,
} from "./stream-registry";
import { isEngineWakingRejection } from "./turn-errors";
import { isTurnRunningRejection } from "./turn-running";

/**
 * Re-sending a message the engine refused as "not now". Three refusals are
 * transient and never lose the message: the pod is waking (a restart, a
 * boot), another turn still holds the conversation (`409 turn running`), or
 * the cloud's shared compute has no room yet (`503 compute_busy`,
 * `send-busy.ts`). Every re-send carries the SAME request (same nonce), so a
 * late acceptance can never double the message, and the bubble stays pending
 * throughout.
 */

/** Where a held send learns the running turn ended (see `TurnSink`). */
export interface TurnEndEvidence {
  /** A counter that grows each time the stream shows a turn end. */
  readonly turnEnds: number;
  /** Resolves once `turnEnds` exceeds `mark`, or `signal` aborts. */
  turnEndAfter(mark: number, signal: AbortSignal): Promise<void>;
}

/** Wait `ms`, waking early on abort. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** How long a `turn running` refusal waits before re-send `attempt`. */
export function turnRunningDelay(
  tuning: StreamTuning | undefined,
  attempt: number,
): number {
  const delays =
    tuning?.sendTurnRunningRetryDelaysMs ?? SEND_TURN_RUNNING_RETRY_DELAYS_MS;
  return delays[Math.min(attempt, delays.length - 1)] ?? 0;
}

/**
 * Send, and re-send while the refusal is transient. A busy refusal re-sends
 * after the server's hint until the busy budget runs out, and once the wait
 * grows long `onBusy` fires so the turn can say so. A waking refusal walks
 * the wake ladder; a `turn running` refusal is HELD: `onHold` fires, then the
 * re-send goes out as soon as the stream shows a turn end (the running turn's
 * terminal frame) or the fallback delay elapses, whichever comes first. The
 * fallback matters on the cloud pool, where the claim frees a beat AFTER the
 * terminal frame, so the first evidence-driven re-send can meet one more 409.
 * Any other refusal, an exhausted ladder or budget, or the caller's abort
 * rejects with the last refusal. The first send goes out synchronously, so
 * the accepted-first-time path keeps its exact timing.
 */
export async function sendHolding(
  /** An engine answering nothing on acceptance names no turn. */
  send: () => Promise<SendAccepted | undefined>,
  evidence: TurnEndEvidence,
  signal: AbortSignal,
  tuning: StreamTuning | undefined,
  onHold: () => void,
  onBusy: () => void = () => {},
): Promise<SendAccepted> {
  const wakeDelays = tuning?.sendWakeRetryDelaysMs ?? SEND_WAKE_RETRY_DELAYS_MS;
  const holdBudget = tuning?.sendTurnRunningHoldMs ?? SEND_TURN_RUNNING_HOLD_MS;
  const busyClock = new SendBusyClock(tuning);
  let wakes = 0;
  let holds = 0;
  let heldSince: number | undefined;
  try {
    for (;;) {
      const mark = evidence.turnEnds;
      let refusal: unknown;
      try {
        return (await send()) ?? {};
      } catch (e) {
        refusal = e;
      }
      if (signal.aborted) throw refusal;
      // Before the waking check: a busy refusal carries the waking error string
      // too, so a client from before the code still re-sends it.
      const busy = computeBusyRefusal(refusal);
      if (busy) {
        if (busyClock.spent) throw refusal;
        // Held, like a send behind a running turn: the stream's frames are not
        // this turn's until it is accepted, so an idle sync cannot settle it.
        onHold();
        busyClock.armNotice(onBusy);
        await pause(busyClock.pauseFor(busy), signal);
        if (busyClock.spent) throw refusal;
      } else if (isEngineWakingRejection(refusal)) {
        const delay = wakeDelays[wakes++];
        if (delay === undefined) throw refusal;
        await pause(delay, signal);
      } else if (isTurnRunningRejection(refusal)) {
        heldSince ??= Date.now();
        if (Date.now() - heldSince >= holdBudget) throw refusal;
        onHold();
        const ac = new AbortController();
        const stop = () => ac.abort();
        signal.addEventListener("abort", stop, { once: true });
        await Promise.race([
          pause(turnRunningDelay(tuning, holds++), ac.signal),
          evidence.turnEndAfter(mark, ac.signal),
        ]);
        ac.abort();
        signal.removeEventListener("abort", stop);
      } else throw refusal;
      if (signal.aborted) throw refusal;
    }
  } finally {
    busyClock.dispose();
  }
}

/**
 * A send handed off over a live observer met `turn running`: wait for the
 * observed turn's observer to settle and leave the registry. False when it
 * outlived the whole hold budget (the send then settles as refused).
 */
export async function observerSettled(
  registry: StreamRegistry,
  key: string,
  observer: ActiveStream,
  tuning: StreamTuning | undefined,
): Promise<boolean> {
  const ac = new AbortController();
  await Promise.race([
    registry.left(key, observer, ac.signal),
    pause(
      tuning?.sendTurnRunningHoldMs ?? SEND_TURN_RUNNING_HOLD_MS,
      ac.signal,
    ),
  ]);
  ac.abort();
  return registry.get(key) !== observer;
}
