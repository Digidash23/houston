/**
 * Undo one optimistic write over a list of keyed rows WITHOUT touching rows it
 * never painted. A whole-list snapshot restore would also wipe rows that
 * landed while the write was in flight (another agent's slice of the
 * aggregate, a neighbour's paint), so a refusal reverts only its own rows.
 *
 * Pure and idempotent: a second run over its own output changes nothing.
 */
export interface RowRevert<R> {
  keyOf: (row: R) => string;
  /** Paint-time rows this write removed or edited: put back as they were. */
  touched: (row: R) => boolean;
  /** Rows this write created: dropped unless the paint-time list had them. */
  added?: (row: R) => boolean;
  /** How a touched row still listed comes back; defaults to its paint-time self. */
  restore?: (current: R, before: R) => R;
}

/**
 * Where paint-time row `from` goes back: after its nearest predecessor still
 * listed, else before its nearest successor (a neighbour's own revert may
 * not have put the predecessor back yet).
 */
function anchorIndex<R>(
  next: R[],
  before: R[],
  from: number,
  keyOf: (row: R) => string,
): number {
  const find = (i: number) => {
    const key = keyOf(before[i] as R);
    return next.findIndex((row) => keyOf(row) === key);
  };
  for (let i = from - 1; i >= 0; i--) {
    const at = find(i);
    if (at !== -1) return at + 1;
  }
  for (let i = from + 1; i < before.length; i++) {
    const at = find(i);
    if (at !== -1) return at;
  }
  return next.length;
}

export function revertRows<R>(
  current: R[] | undefined,
  before: R[] | undefined,
  spec: RowRevert<R>,
): R[] | undefined {
  if (!current || !before) return current;
  const { keyOf } = spec;
  const beforeKeys = new Set(before.map(keyOf));
  const originals = new Map(
    before.filter(spec.touched).map((row) => [keyOf(row), row]),
  );
  let changed = false;
  const next: R[] = [];
  for (const row of current) {
    const key = keyOf(row);
    const original = originals.get(key);
    if (original) {
      const restored = spec.restore ? spec.restore(row, original) : original;
      changed ||= restored !== row;
      next.push(restored);
    } else if (spec.added?.(row) && !beforeKeys.has(key)) {
      changed = true;
    } else {
      next.push(row);
    }
  }
  const listed = new Set(next.map(keyOf));
  before.forEach((row, i) => {
    const key = keyOf(row);
    if (!originals.has(key) || listed.has(key)) return;
    next.splice(anchorIndex(next, before, i, keyOf), 0, row);
    listed.add(key);
    changed = true;
  });
  return changed ? next : current;
}

/** `current` with `keys` set back to `before`'s values (absent stays absent). */
export function restoreFields<R extends object>(
  current: R,
  before: R,
  keys: readonly string[],
): R {
  const next = { ...current };
  for (const key of keys) {
    if (key in before) Reflect.set(next, key, Reflect.get(before, key));
    else Reflect.deleteProperty(next, key);
  }
  return next;
}
