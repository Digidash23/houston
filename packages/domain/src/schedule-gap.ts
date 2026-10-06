import { Cron } from "croner";

/** A fixed start keeps the answer identical on every device and every day. */
const SAMPLE_FROM = new Date("2026-01-01T00:00:00Z");
/**
 * Consecutive fires sampled. A cron's gaps come from its minute list (within an
 * hour) or from two adjacent firing hours or days, and a pattern whose tightest
 * gap spans an hour fires only a few times per hour, so 128 fires reach that
 * pair while keeping one evaluation to a few milliseconds.
 */
const SAMPLE_FIRES = 128;

/**
 * The smallest gap, in minutes, between two consecutive fires of `schedule`,
 * however the cron spells its cadence (`*\/5`, `0-59/5`, `0,5,10`, a list that
 * wraps the hour). Evaluated in UTC: the cadence is a property of the pattern,
 * not of the zone it runs in. Null when the pattern is invalid or fires fewer
 * than twice.
 */
export function minFireGapMinutes(schedule: string): number | null {
  let cron: Cron;
  try {
    cron = new Cron(schedule, { timezone: "UTC" });
  } catch {
    return null;
  }
  let previous = cron.nextRun(SAMPLE_FROM);
  let smallest: number | null = null;
  for (let i = 0; previous && i < SAMPLE_FIRES; i += 1) {
    const next = cron.nextRun(previous);
    if (!next) break;
    const gap = (next.getTime() - previous.getTime()) / 60_000;
    if (smallest === null || gap < smallest) smallest = gap;
    previous = next;
  }
  return smallest;
}

/** A minute-step cron, `*\/N * * * *`: what the editor's custom minutes count writes. */
const MINUTE_STEP = /^\*\/(\d+) \* \* \* \*$/;

/**
 * Whether `cron` respects a plan's `floor` (minimum minutes between fires; no
 * floor allows anything). The ONE rule the app's schedule editor, the SDK and
 * the host's routine-write gate share: a minute step is judged by its nominal
 * N, anything else by its smallest real gap.
 */
export function scheduleFloorAllows(
  cron: string,
  floor: number | undefined,
): boolean {
  if (floor === undefined) return true;
  // `*\/16` restarts at the top of the hour (:48 then :00); the gateway judges
  // real fire times, so it may skip the run that lands under the floor there.
  const step = cron.trim().match(MINUTE_STEP);
  if (step) return Number(step[1]) >= floor;
  const gap = minFireGapMinutes(cron);
  return gap === null || gap >= floor;
}
