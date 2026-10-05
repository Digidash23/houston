/**
 * A clock for measuring spans of time that neither a wall clock set back
 * nor a monotonic clock paused during system sleep can shorten: each reading
 * advances by the larger of the two clocks' steps since the last one, and a
 * wall step that went back counts as none. A wall clock set forward only
 * lengthens the span, which ends a wait early rather than late.
 *
 * It is the {@link Clock.monotonic} reading a host supplies (`performance.now()`
 * stops on macOS WebKit while the machine sleeps). One per process, so every
 * SDK the host builds measures on one timebase.
 */
export function createSpanClock(
  wall: () => number,
  monotonic: () => number,
): () => number {
  let lastWall = wall();
  let lastMonotonic = monotonic();
  let span = 0;
  return () => {
    const nowWall = wall();
    const nowMonotonic = monotonic();
    span += Math.max(0, nowWall - lastWall, nowMonotonic - lastMonotonic);
    lastWall = nowWall;
    lastMonotonic = nowMonotonic;
    return span;
  };
}
