/**
 * A report latch: the first `report` of an episode reaches `onReport`, the
 * rest are dropped until `rearm` starts a new episode. A refusal that repeats
 * on every reconnect or batch is one problem, reported once.
 */
export function reportOnce(onReport: (err: unknown) => void) {
  let reported = false;
  return {
    report(err: unknown): void {
      if (reported) return;
      reported = true;
      onReport(err);
    },
    rearm(): void {
      reported = false;
    },
  };
}
