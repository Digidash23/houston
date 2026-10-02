import { isDeepStrictEqual } from "node:util";

type Entry = Record<string, unknown>;

const isEntry = (value: unknown): value is Entry =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function keyOf(value: unknown, field: string): string | undefined {
  if (!isEntry(value)) return undefined;
  const key = value[field];
  return typeof key === "string" ? key : undefined;
}

function byKey(items: readonly unknown[], field: string): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const item of items) {
    const key = keyOf(item, field);
    if (key !== undefined && isEntry(item)) out.set(key, item);
  }
  return out;
}

function stamp(entry: Entry): number {
  const parsed =
    typeof entry.updated_at === "string"
      ? Date.parse(entry.updated_at)
      : Number.NaN;
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** The later `updated_at` wins; without a later remote stamp the local side
 *  does, as every merged write did before merges kept a base. */
const newer = (local: Entry, remote: Entry): Entry =>
  stamp(remote) > stamp(local) ? remote : local;

/** An entry both sides changed since the base: each field takes the side
 *  that changed it, and a field both changed goes to the newer side. */
function mergeFields(base: Entry, local: Entry, remote: Entry): Entry {
  const winner = newer(local, remote);
  const merged: Entry = {};
  const keys = new Set([
    ...Object.keys(remote),
    ...Object.keys(local),
    ...Object.keys(base),
  ]);
  for (const key of keys) {
    const localChanged = !isDeepStrictEqual(local[key], base[key]);
    const remoteChanged = !isDeepStrictEqual(remote[key], base[key]);
    const value =
      localChanged && remoteChanged
        ? winner[key]
        : localChanged
          ? local[key]
          : remote[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** One key's entry after the merge; undefined = it is gone. */
function resolve(
  base: Entry | undefined,
  local: Entry | undefined,
  remote: Entry | undefined,
): Entry | undefined {
  if (local && remote) {
    if (!base) return newer(local, remote);
    if (isDeepStrictEqual(local, base)) return remote;
    if (isDeepStrictEqual(remote, base)) return local;
    return mergeFields(base, local, remote);
  }
  // In the base and missing from one side: that side deleted it, explicitly.
  // An edit on the other side never brings it back.
  if (base) return undefined;
  return local ?? remote;
}

/**
 * Merge a writer's keyed array (routines and memories by `id`, custom
 * integration definitions by `slug`) into the remote copy it lost a
 * generation race to.
 *
 * With `base` (the bytes the writer started from) this is three-way per
 * entry: an entry the writer left untouched takes the remote's copy, so a
 * stale local copy never reverts another writer's edit, and an entry either
 * side deleted stays deleted. Without a base (the standing pod's sync) the
 * author of a difference is unknowable: both sides' entries survive, and an
 * entry both hold resolves by `updated_at`, else to the local copy.
 *
 * Remote entries the writer lacks come first, then the writer's own in its
 * order: the order every merged write has kept. Entries without a key are
 * kept from both sides.
 */
export function mergeKeyedArrays(
  remote: readonly unknown[],
  local: readonly unknown[],
  field: string,
  base?: readonly unknown[],
): unknown[] {
  const baseEntries = base ? byKey(base, field) : new Map<string, Entry>();
  const localEntries = byKey(local, field);
  const remoteEntries = byKey(remote, field);
  const merged: unknown[] = [];
  const emitted = new Set<string>();
  const emit = (key: string) => {
    if (emitted.has(key)) return;
    emitted.add(key);
    const entry = resolve(
      baseEntries.get(key),
      localEntries.get(key),
      remoteEntries.get(key),
    );
    if (entry) merged.push(entry);
  };
  for (const item of remote) {
    const key = keyOf(item, field);
    if (key === undefined) merged.push(item);
    else if (!localEntries.has(key)) emit(key);
  }
  for (const item of local) {
    const key = keyOf(item, field);
    if (key === undefined) merged.push(item);
    else emit(key);
  }
  return merged;
}
