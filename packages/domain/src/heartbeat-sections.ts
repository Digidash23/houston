/**
 * How one briefing section is ordered and capped. The rule behind it lives in
 * heartbeat-news.ts.
 */

/** Each section keeps this many items; the rest is a count. */
export const HEARTBEAT_SECTION_CAP = 20;

export interface HeartbeatSection<T> {
  items: T[];
  /** How many more matched than the cap kept. */
  more: number;
}

/** An item, its identity key, and its timestamp (ISO, or ""). */
export interface Keyed {
  key: string;
  at: string;
}

/** One section after ordering and capping, with what the seen set needs. */
export interface OrderedSection<T> {
  section: HeartbeatSection<T>;
  /** Items not yet in the seen set, the ones past the cap included. */
  unseen: number;
  /** Keys of the items the section keeps, so the briefing names them. */
  named: string[];
  /** Keys of every matched item. */
  present: string[];
}

/** The item kinds, as their keys spell them (heartbeat-news.ts rule 1). */
export type HeartbeatItemKind = "need" | "done" | "run" | "pause";

/**
 * An item's identity key: `<kind>:<agentId>/<rest>`. `agentId` is the
 * workspace-qualified agent id, so same-named agents in two workspaces never
 * share a key; agent names never contain "/".
 */
export const heartbeatItemKey = (
  kind: HeartbeatItemKind,
  agentId: string,
  rest: string,
) => `${kind}:${agentId}/${rest}`;

/** Whether a key belongs to an item of the agent `agentId`. */
export const keyOfAgent = (key: string, agentId: string) =>
  key.slice(key.indexOf(":") + 1).startsWith(`${agentId}/`);

/** The timestamp as an instant; an absent or unreadable one is null. */
function instant(item: Keyed): number | null {
  const ms = Date.parse(item.at);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Compare two items by instant, oldest first. An item without a readable
 * timestamp counts as the oldest (told first, so it can never starve); ties
 * fall back to the key, so the order is total and stable.
 */
function oldestFirst(a: Keyed, b: Keyed): number {
  const ta = instant(a) ?? Number.NEGATIVE_INFINITY;
  const tb = instant(b) ?? Number.NEGATIVE_INFINITY;
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Unseen items first, OLDEST first, so a cap only ever holds back the newest
 * unseen ones for the next briefing; then seen items, newest first. Times
 * compare as parsed instants, never as strings.
 */
export function orderSection<T extends Keyed>(
  items: readonly T[],
  seen: ReadonlySet<string>,
): OrderedSection<T> {
  const unseen = items.filter((item) => !seen.has(item.key)).sort(oldestFirst);
  const told = items
    .filter((item) => seen.has(item.key))
    .sort((a, b) => oldestFirst(b, a));
  const ordered = [...unseen, ...told];
  const kept = ordered.slice(0, HEARTBEAT_SECTION_CAP);
  return {
    section: {
      items: kept,
      more: Math.max(0, ordered.length - HEARTBEAT_SECTION_CAP),
    },
    unseen: unseen.length,
    named: kept.map((item) => item.key),
    present: items.map((item) => item.key),
  };
}
