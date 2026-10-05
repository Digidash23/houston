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
class PersonStop {
  readonly answered: Promise<void>;
  readonly finish: () => void;

  constructor() {
    let resolve: () => void = () => {};
    this.answered = new Promise<void>((r) => {
      resolve = r;
    });
    this.finish = () => resolve();
  }
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
  // `post` aborts the request still out; `hold` ends the re-send loop, on a
  // teardown (the stream's own abort) or a Stop.
  const post = new AbortController();
  const hold = new AbortController();
  const endHold = () => hold.abort();
  ac.signal.addEventListener("abort", endHold, { once: true });
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
    if (sink.settled || stop) return null;
    stop = new PersonStop();
    post.abort();
    hold.abort();
    return stop.finish;
  };
  try {
    return await sendHolding(
      () => turn.send(post.signal),
      sink,
      hold.signal,
      turn.tuning,
      {
        onHold: () => sink.holdSend(),
        onBusy: showBusy,
        firstRefusal: turn.firstRefusal,
      },
    );
  } catch (e) {
    if (stop) {
      clearBusy();
      await stop.answered;
      sink.fail(STOPPED_BY_USER); // a no-op when frames settled it meanwhile
      ac.abort();
    }
    throw e;
  } finally {
    entry.stopUnsent = undefined;
    ac.signal.removeEventListener("abort", endHold);
    ac.signal.removeEventListener("abort", clearBusy);
    clearBusy();
  }
}

/** The Stop hook {@link armHandoffStop} arms, and what it learned. */
export interface HandoffStop {
  /** Aborts the handoff's POST, and any hold behind the observed turn. */
  signal: AbortSignal;
  /** Set once the person stopped it: resolves when the engine's cancel answered. */
  stopped(): Promise<void> | undefined;
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
): HandoffStop {
  const post = new AbortController();
  let stop: PersonStop | undefined;
  const hook = () => {
    if (stop) return null;
    stop = new PersonStop();
    post.abort();
    return stop.finish;
  };
  registry.armSendStop(key, hook);
  return {
    signal: post.signal,
    stopped: () => stop?.answered,
    disarm: () => registry.disarmSendStop(key, hook),
  };
}
