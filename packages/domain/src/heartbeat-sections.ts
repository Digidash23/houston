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

/**
 * Unseen items first, OLDEST first, so a cap only ever holds back the newest
 * unseen ones for the next briefing; then seen items, newest first.
 */
export function orderSection<T extends Keyed>(
  items: readonly T[],
  seen: ReadonlySet<string>,
): OrderedSection<T> {
  const unseen = items
    .filter((item) => !seen.has(item.key))
    .sort((a, b) => a.at.localeCompare(b.at));
  const told = items
    .filter((item) => seen.has(item.key))
    .sort((a, b) => b.at.localeCompare(a.at));
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
