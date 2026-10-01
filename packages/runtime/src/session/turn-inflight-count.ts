/**
 * How many turns this runtime holds right now: queued on their conversation,
 * waiting on the workdir lock, or executing. A `/clear` or `/compact` counts
 * as one too: it rides the same queue and lock and is real work on the
 * conversation.
 *
 * This is the runtime's answer to "is anything running here?" (`GET /busy`,
 * the graceful-shutdown drain). It follows each turn's LIFECYCLE, never its
 * stream: the stream snapshot (bus.ts) is a replay aid for reconnecting
 * clients, and a frame published out of order leaves it reading running for a
 * turn that already ended. A wrong "running" there is a stale spinner; here it
 * is a pod that never reads idle, so the fleet roll defers on it forever.
 */
let inFlight = 0;

/**
 * Count one turn in flight until the returned release runs. Release in a
 * `finally`: a turn that settles without releasing would hold the runtime
 * busy for the life of the process. Releasing twice is a no-op.
 */
export function holdTurnInFlight(): () => void {
  inFlight++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight--;
  };
}

/** Turns held right now (see the module note for what counts). */
export function turnsInFlight(): number {
  return inFlight;
}
