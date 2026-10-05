import type { SendAccepted } from "@houston/runtime-client";
import type { FeedOutput } from "./feed-output";
import { sendHolding } from "./send-hold";
import type {
  ActiveStream,
  StreamRegistry,
  StreamTuning,
} from "./stream-registry";
import { STOPPED_BY_USER } from "./turn-errors";
import type { TurnSink } from "./turn-sink";

/**
 * The person's Stop of a message the engine has not accepted. The send ends
 * at once; the turn settles as stopped only once the caller's engine cancel
 * answered (`finish`), however long that takes. Settling first would let a
 * message queued behind the turn go out, and that cancel would then stop it
 * instead. Every caller calls `finish` in a `finally`, so a cancel that fails
 * settles the turn too.
 */
export class PersonStop {
  readonly answered: Promise<void>;
  private resolve: () => void = () => {};
  /** Cancels still out: a second Stop sends a second one. */
  private pending = 0;
  private done = false;

  constructor() {
    this.answered = new Promise<void>((r) => {
      this.resolve = r;
    });
  }

  /**
   * One Stop's cancel: the `finish` its caller calls once that cancel
   * answered. The turn settles only when every cancel out has answered, so
   * none of them can reach a message queued behind it. Null once settled.
   */
  join(): (() => void) | null {
    if (this.done) return null;
    this.pending++;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (--this.pending > 0) return;
      this.done = true;
      this.resolve();
    };
  }
}

/** A send the person stopped: never ambiguous, so nothing waits on it. */
function stoppedError(): Error {
  const e = new Error(STOPPED_BY_USER);
  e.name = "AbortError";
  return e;
}

/** What {@link sendUntilAccepted} works on: one turn's fresh send. */
export interface UnsentTurn {
  /** One POST of the message; `signal` aborts it when the person stops. */
  send: (signal: AbortSignal) => Promise<SendAccepted | undefined>;
  sink: TurnSink;
  /** The turn's registry entry, which carries the hold and the Stop hook. */
  entry: ActiveStream;
  /** The turn's stream controller: a teardown aborts it. */
  ac: AbortController;
  tuning: StreamTuning | undefined;
  output: FeedOutput;
  agentPath: string;
  sessionKey: string;
  /** A refusal the observer handoff's send already met. */
  firstRefusal?: unknown;
  /** When that send went out: its busy wait counts from then. */
  firstSentAt?: number;
}

/**
 * The fresh path's send: `sendHolding`, plus what its wait owns until the
 * engine accepts the message. The person's Stop (the registry's
 * `stopUnsent`) ends it here: the POST still out is aborted, no re-send
 * follows, and the turn settles as stopped once the engine's cancel
 * answered. The busy line shows only while the stream lives, and goes the
 * moment it is torn down.
 */
export async function sendUntilAccepted(
  turn: UnsentTurn,
): Promise<SendAccepted> {
  const { sink, entry, ac, output, agentPath, sessionKey } = turn;
  // `post` aborts the request still out; `hold` ends the re-send loop. A
  // teardown (the stream's own abort) and a Stop end both.
  const post = new AbortController();
  const hold = new AbortController();
  const endSend = () => {
    post.abort();
    hold.abort();
  };
  ac.signal.addEventListener("abort", endSend, { once: true });
  let shown = false;
  const showBusy = () => {
    if (ac.signal.aborted || shown) return;
    shown = true;
    output.sendWaiting?.(agentPath, sessionKey, "busy");
  };
  const clearBusy = () => {
    if (!shown) return;
    shown = false;
    output.sendWaiting?.(agentPath, sessionKey, null);
  };
  ac.signal.addEventListener("abort", clearBusy, { once: true });
  let stop: PersonStop | undefined;
  entry.stopUnsent = () => {
    if (sink.settled) return null;
    if (stop) return stop.join();
    stop = new PersonStop();
    // Until the cancel answered no frame settles it, and the queue watchdog
    // flushes nothing into that cancel.
    sink.mute();
    entry.held = true;
    endSend();
    return stop.join();
  };
  try {
    const accepted = await sendHolding(
      () => turn.send(post.signal),
      sink,
      hold.signal,
      turn.tuning,
      {
        onHold: () => {
          sink.holdSend();
          entry.held = true;
        },
        onBusy: showBusy,
        firstRefusal: turn.firstRefusal,
        busySince: turn.firstSentAt,
      },
    );
    if (!stop) return accepted;
    // The 202 landed in the same tick as the Stop: the Stop wins, and the
    // engine's cancel stops the turn it took.
    throw stoppedError();
  } catch (e) {
    if (stop) {
      clearBusy();
      await stop.answered;
      // A no-op when frames settled it meanwhile; nothing after a teardown.
      if (!ac.signal.aborted) sink.fail(STOPPED_BY_USER);
      ac.abort();
    }
    throw e;
  } finally {
    entry.held = false;
    entry.stopUnsent = undefined;
    ac.signal.removeEventListener("abort", endSend);
    ac.signal.removeEventListener("abort", clearBusy);
    clearBusy();
  }
}

/** The Stop hook {@link armHandoffStop} arms, and what it learned. */
export interface HandoffStop {
  /** Aborts the handoff's POST, and any hold behind the observed turn. */
  signal: AbortSignal;
  /** Set once the person stopped it: settles once every cancel answered. */
  stopped(): PersonStop | undefined;
  disarm(): void;
}

/**
 * A Stop hook for the observer handoff's send, armed on the registry while
 * its POST (and any hold behind the observed turn) is out: the key still
 * belongs to the observer, so there is no turn entry for `stopUnsent` yet.
 */
export function armHandoffStop(
  registry: StreamRegistry,
  key: string,
  /** Runs at the Stop, before anything unwinds (the observer's dispose). */
  onStop: () => void,
): HandoffStop {
  const post = new AbortController();
  let stop: PersonStop | undefined;
  const hook = () => {
    if (stop) return stop.join();
    stop = new PersonStop();
    onStop();
    post.abort();
    return stop.join();
  };
  registry.armSendStop(key, hook);
  return {
    signal: post.signal,
    stopped: () => stop,
    disarm: () => registry.disarmSendStop(key, hook),
  };
}
