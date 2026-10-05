/**
 * A one-shot hold for the specs that act mid-turn (drop, turn boundary, kill).
 * Armed by `chat-config { holdAfterFirstDelta: true }`, the NEXT turn stops
 * after its first text delta until a test control releases it. A paced turn
 * cannot promise that: a loaded CI runner opened the chat stream only after a
 * 7.5 s turn had ended, so the control found nothing running.
 */

/** Ends a hold nobody released, so a spec that never acts cannot hang the turn. */
const HOLD_MAX_MS = 60_000;

let armed = false;
let release: (() => void) | null = null;

export function armHoldAfterFirstDelta(on: boolean): void {
  armed = on;
}

/** Whether this turn takes the armed hold (one-shot: the next turn runs free). */
export function takeHold(): boolean {
  const take = armed;
  armed = false;
  return take;
}

/** Wait until `releaseHeldTurn` (or the safety cap). */
export function waitForRelease(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, HOLD_MAX_MS);
    function done(): void {
      clearTimeout(timer);
      if (release === done) release = null;
      resolve();
    }
    release = done;
  });
}

/** Let a held turn continue; a no-op when nothing is held. */
export function releaseHeldTurn(): void {
  release?.();
}

/** Disarm and release (test reset). */
export function resetHold(): void {
  armed = false;
  releaseHeldTurn();
}
