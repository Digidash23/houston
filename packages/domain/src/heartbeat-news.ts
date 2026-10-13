import {
  type HeartbeatSnapshot,
  isHeartbeatSnapshotEmpty,
} from "./heartbeat-snapshot";

const DAY_MS = 86_400_000;

/**
 * The "only when there is news" rule of the scheduled morning briefing. The
 * cloud gateway's scheduler implements the same rule; keep the two identical.
 *
 * The baseline is a COVERAGE WATERMARK (`briefedThrough`), never a clock
 * reading: the newest timestamp among the items a finished briefing actually
 * named, held just below the oldest fresh item a section cap cut
 * (heartbeat-coverage.ts), and never moving backwards. Only a briefing turn
 * that FINISHED with a reply moves it (heartbeat-briefing.ts): admission alone
 * does not, nor does a quiet run, nor a turn that failed. A briefing that named
 * no timestamped item leaves it where it was.
 *
 * A scheduled run calls the model only when at least one item is FRESH: its
 * timestamp is strictly newer than the watermark (with no watermark, any
 * timestamped item). With no finished briefing ever, any item counts, fresh or
 * not. An empty snapshot is never news. Otherwise the run records "quiet".
 *
 * Each section puts fresh items first, oldest first, then the rest newest
 * first, and only then caps, so what a cap cuts is newer than what was named
 * and is still fresh next time. Items past the cap still count as news.
 *
 * The timestamp of each item kind:
 * - waiting on the person, and finished: the mission's `updated_at`. A mission
 *   carries no "entered needs_you at"; `updated_at` is bumped on every write,
 *   so it is the closest field. A mission without one (a hand-written or
 *   legacy row) is never fresh, so it is news only before any briefing.
 * - routine runs: `completed_at`, else `started_at`.
 * - paused routines: `auto_paused.at`, when the engine paused it.
 *
 * Times compare as instants, never as strings. A "brief me now" run skips
 * the rule (the person asked) and is quiet only on an empty snapshot.
 */
export function heartbeatHasNews(
  snapshot: HeartbeatSnapshot,
  everBriefed: boolean,
): boolean {
  if (isHeartbeatSnapshotEmpty(snapshot)) return false;
  return !everBriefed || snapshot.freshCount > 0;
}

/**
 * Where the snapshot's look-back window for finished missions and routine
 * runs opens: just past the watermark, so anything the last briefing did not
 * cover is in it; with none, a day ago.
 */
export function heartbeatWindowStart(
  briefedThrough: string | null,
  nowMs: number,
): number {
  const through =
    briefedThrough === null ? Number.NaN : Date.parse(briefedThrough);
  return Number.isNaN(through) ? nowMs - DAY_MS : through + 1;
}

/** The watermark as the snapshot builder takes it. */
export function briefedThroughMs(briefedThrough: string | null): number | null {
  const through =
    briefedThrough === null ? Number.NaN : Date.parse(briefedThrough);
  return Number.isNaN(through) ? null : through;
}
