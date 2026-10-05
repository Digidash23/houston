import type { SendAccepted } from "@houston/runtime-client";
import type { FeedOutput } from "./feed-output";
import { sendHolding } from "./send-hold";
import type { ActiveStream, StreamTuning } from "./stream-registry";
import { STOPPED_BY_USER } from "./turn-errors";
import type { TurnSink } from "./turn-sink";

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
 * follows, and the turn settles as stopped. The busy line shows only while
 * the stream lives, and goes the moment it is torn down.
 */
export async function sendUntilAccepted(
  turn: UnsentTurn,
): Promise<SendAccepted> {
  const { sink, entry, ac, output, agentPath, sessionKey } = turn;
  const stop = new AbortController();
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
  entry.stopUnsent = () => {
    if (sink.settled) return false;
    sink.fail(STOPPED_BY_USER);
    stop.abort();
    ac.abort();
    return true;
  };
  try {
    return await sendHolding(
      () => turn.send(stop.signal),
      sink,
      ac.signal,
      turn.tuning,
      {
        onHold: () => {
          sink.holdSend();
          entry.held = true;
        },
        onBusy: showBusy,
        firstRefusal: turn.firstRefusal,
      },
    );
  } finally {
    entry.held = false;
    entry.stopUnsent = undefined;
    ac.signal.removeEventListener("abort", clearBusy);
    clearBusy();
  }
}
