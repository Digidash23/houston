import { keyOfAgent } from "./heartbeat-sections";
import type { HeartbeatSnapshot } from "./heartbeat-snapshot";

/**
 * The "only when there is news" rule of the scheduled morning briefing, by
 * SEEN KEYS, never by timestamps. The cloud gateway's scheduler implements
 * the same rule; keep the two identical.
 *
 * 1. Every snapshot item has an identity key:
 *    - a mission waiting on the person: `need:<agent>/<missionId>`
 *    - a finished mission:              `done:<agent>/<missionId>`
 *    - a routine run (failed/surfaced): `run:<agent>/<runId>`
 *    - a routine the engine paused:     `pause:<agent>/<routineId>:<auto_paused.at>`
 *    `<agent>` is a stable, workspace-qualified agent identity (locally the
 *    agent id `<workspaceId>/<name>`), never the bare display name, so two
 *    same-named agents in different workspaces never share a key. A re-pause
 *    gets a new `auto_paused.at`, so it is a new item.
 * 2. The heartbeat document keeps `seen`: the keys the person has been told.
 *    A document without it reads as empty (at worst one extra briefing).
 * 3. Each section puts unseen items first, oldest first, then seen ones,
 *    newest first, and only then caps at HEARTBEAT_SECTION_CAP.
 * 4. A scheduled run calls the model only when at least one matched item is
 *    unseen, items past the cap included. Otherwise it records "quiet". A
 *    "brief me now" run skips this and is quiet only on an empty snapshot.
 * 5. Only a CONFIRMED delivery (the briefing turn finished with a reply,
 *    heartbeat-briefing.ts) changes `seen`, to: the keys of the items the
 *    briefing named, plus the previously seen keys still present in that
 *    snapshot, plus every previously seen key of an agent whose documents
 *    could not be read for that snapshot (its items are unknown, not gone).
 *    Keys of items gone from a read agent drop out, so `seen` stays bounded.
 *    Quiet runs and failed briefings never change it.
 *
 * Finished missions and routine runs are matched over a fixed look-back of
 * HEARTBEAT_LOOKBACK_MS; waiting missions and paused routines are matched
 * whenever they are in that state. Item timestamps only order a section (as
 * parsed instants, an absent or unreadable one counting as the oldest, ties
 * broken by key) and bound the look-back (parsed instants too): the mission's
 * `updated_at`, the run's `completed_at` else `started_at`, the pause's
 * `auto_paused.at`.
 */
export function heartbeatHasNews(snapshot: HeartbeatSnapshot): boolean {
  return snapshot.unseen > 0;
}

/** The look-back for finished missions and routine runs. */
export const HEARTBEAT_LOOKBACK_MS = 48 * 60 * 60 * 1000;

/** Where the look-back for finished missions and routine runs opens. */
export function heartbeatWindowStart(nowMs: number): number {
  return nowMs - HEARTBEAT_LOOKBACK_MS;
}

/** Rule 5: `seen` after this snapshot's briefing is confirmed delivered. */
export function seenAfterDelivery(
  snapshot: HeartbeatSnapshot,
  seen: readonly string[],
): string[] {
  const present = new Set(snapshot.presentKeys);
  const kept = seen.filter(
    (k) =>
      present.has(k) || snapshot.unreadAgents.some((a) => keyOfAgent(k, a)),
  );
  return [...new Set([...snapshot.namedKeys, ...kept])];
}
