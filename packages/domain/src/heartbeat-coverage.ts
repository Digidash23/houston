/**
 * How one briefing section is ordered and capped, and what a delivered
 * briefing covered. The rules behind them live in heartbeat-news.ts.
 */

/** Each section keeps this many items; the rest is a count. */
export const HEARTBEAT_SECTION_CAP = 20;

export interface HeartbeatSection<T> {
  items: T[];
  /** How many more matched than the cap kept. */
  more: number;
}

/** An item and its timestamp (ISO, or "" when it carries none). */
export interface Timed {
  at: string;
}

/** One section after ordering and capping, plus what feeds the coverage. */
export interface CoveredSection<T> {
  section: HeartbeatSection<T>;
  /** Items newer than the baseline, the ones past the cap included. */
  fresh: number;
  /** Newest timestamp the kept items carry; -Infinity when none. */
  newestKeptMs: number;
  /** Oldest timestamp among fresh items the cap cut; Infinity when none. */
  oldestCutFreshMs: number;
}

const msOf = (item: Timed) => Date.parse(item.at);

/**
 * Fresh items (newer than `briefedThroughMs`, or every timestamped one when
 * nothing was briefed yet) come first, OLDEST first; the rest follow newest
 * first. Capping then only ever cuts fresh items newer than every fresh item
 * kept, so whatever the cap cuts is still news on the next run.
 */
export function coverSection<T extends Timed>(
  items: readonly T[],
  briefedThroughMs: number | null,
): CoveredSection<T> {
  const isFresh = (item: T) => {
    const ms = msOf(item);
    return (
      !Number.isNaN(ms) && (briefedThroughMs === null || ms > briefedThroughMs)
    );
  };
  const fresh = items.filter(isFresh).sort((a, b) => msOf(a) - msOf(b));
  const rest = items
    .filter((item) => !isFresh(item))
    .sort((a, b) => b.at.localeCompare(a.at));
  const ordered = [...fresh, ...rest];
  const kept = ordered.slice(0, HEARTBEAT_SECTION_CAP);
  const cutFresh = fresh.slice(HEARTBEAT_SECTION_CAP);
  return {
    section: {
      items: kept,
      more: Math.max(0, ordered.length - HEARTBEAT_SECTION_CAP),
    },
    fresh: fresh.length,
    newestKeptMs: Math.max(
      Number.NEGATIVE_INFINITY,
      ...kept.map(msOf).filter((ms) => !Number.isNaN(ms)),
    ),
    oldestCutFreshMs: Math.min(Number.POSITIVE_INFINITY, ...cutFresh.map(msOf)),
  };
}

/**
 * What a delivered briefing covered: the newest timestamp it named, held just
 * below the oldest fresh item any section's cap cut, so a cut item is news on
 * the next run even when another section named something newer. Null when no
 * named item carries a timestamp.
 */
export function coveredThrough(
  sections: readonly CoveredSection<unknown>[],
): number | null {
  const newestKept = Math.max(...sections.map((s) => s.newestKeptMs));
  const oldestCut = Math.min(...sections.map((s) => s.oldestCutFreshMs));
  const covered = Math.min(newestKept, oldestCut - 1);
  return Number.isFinite(covered) ? covered : null;
}
