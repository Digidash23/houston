import {
  type HeartbeatSnapshot,
  isHeartbeatSnapshotEmpty,
} from "./heartbeat-snapshot";

const DAY_MS = 86_400_000;

/**
 * The "only when there is news" rule of the scheduled morning briefing. The
 * cloud gateway's scheduler implements the same rule; keep the two identical.
 *
 * A scheduled run calls the model only when at least one snapshot item has a
 * timestamp STRICTLY newer than the `at` of the last DELIVERED run (a quiet or
 * failed run never moves that baseline). Otherwise it records "quiet". With no
 * delivered run ever (or an unreadable one), any item counts as news. An empty
 * snapshot is never news.
 *
 * The timestamp of each item kind:
 * - waiting on the person, and finished: the mission's `updated_at`. A mission
 *   carries no "entered needs_you at"; `updated_at` is bumped on every write,
 *   so it is the closest field. A mission without one (a hand-written or
 *   legacy row) never counts as news on its own, only on a first run.
 * - routine runs: `completed_at`, else `started_at`.
 * - paused routines: `auto_paused.at`, when the engine paused it.
 *
 * Items past the section cap still count. Times compare as instants, never as
 * strings. A "brief me now" run skips this rule: the person asked.
 */
export function heartbeatHasNews(
  snapshot: HeartbeatSnapshot,
  lastDeliveredAt: string | null,
): boolean {
  if (isHeartbeatSnapshotEmpty(snapshot)) return false;
  const since =
    lastDeliveredAt === null ? Number.NaN : Date.parse(lastDeliveredAt);
  if (Number.isNaN(since)) return true;
  return snapshot.newestMs !== null && snapshot.newestMs > since;
}

/**
 * Where the snapshot's look-back window opens: the last delivered briefing,
 * so missions finished since then are told even across quiet or failed days
 * (no quiet day can hide one: it would have been news), else a day ago.
 */
export function heartbeatWindowStart(
  lastDeliveredAt: string | null,
  nowMs: number,
): number {
  const since =
    lastDeliveredAt === null ? Number.NaN : Date.parse(lastDeliveredAt);
  return Number.isNaN(since) ? nowMs - DAY_MS : since;
}
