import { isDeepStrictEqual } from "node:util";

/** The board document; the gateway rewrites it (if-generation-match) mid-turn. */
export const ACTIVITY_DOC = ".houston/activity/activity.json";

type Card = Record<string, unknown>;

function isCard(value: unknown): value is Card {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cardId(value: unknown): string | undefined {
  return isCard(value) && typeof value.id === "string" ? value.id : undefined;
}

function byId(items: readonly unknown[]): Map<string, Card> {
  const out = new Map<string, Card>();
  for (const item of items) {
    const id = cardId(item);
    if (id !== undefined && isCard(item)) out.set(id, item);
  }
  return out;
}

function updatedAt(card: Card): number {
  const value = card.updated_at;
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** Field-level merge of one card both sides kept: remote wins a field both changed. */
function mergeCardFields(base: Card, local: Card, remote: Card): Card {
  const merged: Card = {};
  const keys = new Set([
    ...Object.keys(remote),
    ...Object.keys(local),
    ...Object.keys(base),
  ]);
  for (const key of keys) {
    const localChanged = !isDeepStrictEqual(local[key], base[key]);
    const remoteChanged = !isDeepStrictEqual(remote[key], base[key]);
    const value = localChanged && !remoteChanged ? local[key] : remote[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/**
 * Without a base the change author is unknowable, so the newer `updated_at`
 * wins and a tie (or no stamp) goes to the remote: the gateway's writes are a
 * person's edits, and the turn's untouched copy of a card must never revert one.
 */
function pickNewer(local: Card, remote: Card): Card {
  return updatedAt(local) > updatedAt(remote) ? local : remote;
}

/** Resolve one card id; undefined means the card is gone from the merge. */
function resolveCard(
  base: Card | undefined,
  local: Card | undefined,
  remote: Card | undefined,
): Card | undefined {
  if (local && remote) {
    if (base) return mergeCardFields(base, local, remote);
    return pickNewer(local, remote);
  }
  if (local) {
    // In the base but not remote = deleted remotely: never resurrected.
    return base ? undefined : local;
  }
  if (remote) {
    // The turn deleted it: stays deleted unless the remote changed it since.
    if (base && isDeepStrictEqual(base, remote)) return undefined;
    return remote;
  }
  return undefined;
}

/**
 * Merge the turn's activity array into a refreshed remote one by card `id`.
 *
 * With `base` (the bytes the turn hydrated) this is a three-way merge per card
 * and per field. Without it, the union of both sides survives (a remote delete
 * made mid-turn can come back, the only loss-free choice) and a card both
 * sides hold resolves by `updated_at`. Entries without an id keep the remote's
 * copies plus any local one the remote does not already hold.
 */
export function mergeActivityArrays(
  remote: readonly unknown[],
  local: readonly unknown[],
  base?: readonly unknown[],
): unknown[] {
  const baseCards = base ? byId(base) : new Map<string, Card>();
  const localCards = byId(local);
  const remoteCards = byId(remote);
  const order = [...remoteCards.keys()];
  for (const id of localCards.keys()) {
    if (!remoteCards.has(id)) order.push(id);
  }
  const merged: unknown[] = [];
  for (const id of order) {
    const card = resolveCard(
      baseCards.get(id),
      localCards.get(id),
      remoteCards.get(id),
    );
    if (card) merged.push(card);
  }
  const remoteLoose = remote.filter((item) => cardId(item) === undefined);
  const localLoose = local.filter(
    (item) =>
      cardId(item) === undefined &&
      !remoteLoose.some((kept) => isDeepStrictEqual(kept, item)),
  );
  return [...merged, ...remoteLoose, ...localLoose];
}
