/**
 * The optimistic shape of a Memory (learnings) write: what the list shows the
 * instant a learning is added, edited or removed, before the file write lands.
 * The list is the raw `learnings.json` array the query caches.
 *
 * Every patch is idempotent and tolerates a list that never loaded, because
 * `optimisticWrite` re-runs it over any refetch that lands mid-write.
 *
 * Pure + dependency-free (`app/tests/learning-optimistic.test.ts`).
 */

import type { Learning, LearningAuthor } from "../data/learnings";

/**
 * A learning the user typed, built whole before the write: the id is minted
 * here so the painted row and the stored row are the same row. `taughtBy` is
 * provenance and is stamped ONLY in multiplayer (the caller decides), so a
 * single-player file stays free of identity keys. No mission is stamped: a
 * learning typed in settings did not come from one.
 */
export function newLearning(
  text: string,
  taughtBy: LearningAuthor | undefined,
  id: string,
  nowIso: string,
): Learning {
  return {
    id,
    text,
    created_at: nowIso,
    ...(taughtBy ? { taught_by: taughtBy } : {}),
  };
}

/** The list with `learning` at the end, once. */
export function appendLearning(
  list: Learning[] | undefined,
  learning: Learning,
): Learning[] | undefined {
  if (!list) return list;
  if (list.some((entry) => entry.id === learning.id)) return list;
  return [...list, learning];
}

/** The list with one learning's text replaced. */
export function editLearning(
  list: Learning[] | undefined,
  id: string,
  text: string,
): Learning[] | undefined {
  if (!list) return list;
  return list.map((entry) =>
    entry.id === id && entry.text !== text ? { ...entry, text } : entry,
  );
}

/** The list without one learning. */
export function dropLearning(
  list: Learning[] | undefined,
  id: string,
): Learning[] | undefined {
  if (!list?.some((entry) => entry.id === id)) return list;
  return list.filter((entry) => entry.id !== id);
}
