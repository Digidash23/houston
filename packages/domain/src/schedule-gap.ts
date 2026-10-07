import { Cron } from "croner";

/** A fixed start keeps the answer identical on every device and every day. */
const SAMPLE_FROM = new Date("2026-01-01T00:00:00Z");
/**
 * Consecutive fires sampled. A cron's gaps come from its minute list (within an
 * hour) or from two adjacent firing hours or days, and a pattern whose tightest
 * gap spans an hour fires only a few times per hour, so 128 fires reach that
 * pair while keeping one evaluation well under a millisecond.
 */
const SAMPLE_FIRES = 128;

/**
 * The smallest gap, in minutes, between two consecutive fires of `schedule`,
 * however the cron spells its cadence (`*\/5`, `0-59/5`, `0,5,10`, a list that
 * wraps the hour, a step that restarts at the top of the hour). Evaluated at a
 * fixed UTC offset: the cadence is a property of the pattern, not of the zone
 * it runs in, and a named zone costs ~40x more per fire (the schedule editor
 * judges every minute count it offers). Null when the pattern is invalid or
 * fires fewer than twice.
 */
export function minFireGapMinutes(schedule: string): number | null {
  let fires: Date[];
  try {
    fires = new Cron(schedule, { utcOffset: 0 }).nextRuns(
      SAMPLE_FIRES + 1,
      SAMPLE_FROM,
    );
  } catch {
    return null;
  }
  let smallest: number | null = null;
  let previous: Date | undefined;
  for (const fire of fires) {
    if (previous) {
      const gap = (fire.getTime() - previous.getTime()) / 60_000;
      if (smallest === null || gap < smallest) smallest = gap;
    }
    previous = fire;
  }
  return smallest;
}

/**
 * Whether `cron` respects a plan's `floor` (minimum minutes between fires; no
 * floor allows anything), judged by its smallest REAL gap, the way the gateway
 * judges fires: `*\/16` restarts at the top of the hour (:48 then :00, 12
 * minutes), so it fires more often than its step says. The ONE rule the app's
 * schedule editor, the SDK and the host's routine-write gate share. A pattern
 * with no gap to judge passes: validity is the schedule validator's call.
 */
export function scheduleFloorAllows(
  cron: string,
  floor: number | undefined,
): boolean {
  if (floor === undefined) return true;
  const gap = minFireGapMinutes(cron);
  return gap === null || gap >= floor;
}
