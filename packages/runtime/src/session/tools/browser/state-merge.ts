import type { BrowserContext } from "playwright-core";

/** Playwright's storageState: cookies plus per-origin storage. */
export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type Cookie = StorageState["cookies"][number];
type OriginState = StorageState["origins"][number];

export const EMPTY_STATE: StorageState = { cookies: [], origins: [] };

const cookieKey = (c: Cookie) => `${c.name}\0${c.domain}\0${c.path}`;

/** Storage order is not meaningful, so it never counts as a change. */
function canonicalOrigin(o: OriginState): string {
  const local = [...o.localStorage].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return JSON.stringify({ ...o, localStorage: local });
}

function mergeKeyed<T>(
  base: readonly T[],
  ours: readonly T[],
  theirs: readonly T[],
  key: (item: T) => string,
  same: (a: T, b: T) => boolean,
): T[] {
  const merged = new Map(theirs.map((item) => [key(item), item]));
  const ourKeys = new Set(ours.map(key));
  const before = new Map(base.map((item) => [key(item), item]));
  for (const [k] of before) if (!ourKeys.has(k)) merged.delete(k);
  for (const item of ours) {
    const was = before.get(key(item));
    if (!was || !same(was, item)) merged.set(key(item), item);
  }
  return [...merged.values()];
}

/**
 * Three-way merge of one conversation's sign-ins into the saved file. Every
 * conversation in a workspace has its own context, loaded from the file when
 * it opened, so a plain overwrite would let a chat that opened earlier erase
 * a sign-in another chat made since. Only what THIS context changed since
 * `base` lands: a cookie or origin it set or changed is written, one it
 * removed (a sign-out) is deleted, and everything else keeps the file's value.
 * Cookies are keyed by name + domain + path, origins by origin.
 */
export function mergeStorageState(
  base: StorageState,
  ours: StorageState,
  theirs: StorageState,
): StorageState {
  return {
    cookies: mergeKeyed(
      base.cookies,
      ours.cookies,
      theirs.cookies,
      cookieKey,
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    ),
    origins: mergeKeyed(
      base.origins,
      ours.origins,
      theirs.origins,
      (o) => o.origin,
      (a, b) => canonicalOrigin(a) === canonicalOrigin(b),
    ),
  };
}

/** A parsed file that has the two arrays a storageState needs. */
export function isStorageState(value: unknown): value is StorageState {
  if (typeof value !== "object" || value === null) return false;
  const { cookies, origins } = value as Record<string, unknown>;
  return Array.isArray(cookies) && Array.isArray(origins);
}
