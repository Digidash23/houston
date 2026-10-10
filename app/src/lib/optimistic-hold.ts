import {
  matchQuery,
  type QueryCacheNotifyEvent,
  type QueryClient,
} from "@tanstack/react-query";
import type { OptimisticPatch } from "./optimistic-core";

/**
 * The patches of every optimistic write still in flight, per client. Any data
 * that lands on a matching key while a write is pending carries the PRE-write
 * truth (a deleted card still listed), so it gets the pending patches
 * re-applied over it. That covers a refetch, a direct slice write
 * (`patchAgentSlice`, how an agent's events refresh the aggregate) and the
 * snapshot a refused neighbour restores: without it any of them resurrects a
 * card whose own delete is still in flight.
 */
const pending = new WeakMap<QueryClient, Set<OptimisticPatch>>();

function subscribe(qc: QueryClient): Set<OptimisticPatch> {
  const set = new Set<OptimisticPatch>();
  pending.set(qc, set);
  // Our own re-application is a setQueryData too; the cache notifies
  // synchronously, so this flag is what stops it re-entering itself.
  let reapplying = false;
  qc.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
    if (reapplying || set.size === 0 || event.type !== "updated") return;
    if (event.action.type !== "success") return;
    const { query } = event;
    reapplying = true;
    try {
      for (const patch of set) {
        if (!matchQuery({ queryKey: patch.queryKey }, query)) continue;
        const current = query.state.data;
        const next = patch.apply(current);
        if (next !== current) qc.setQueryData(query.queryKey, next);
      }
    } finally {
      reapplying = false;
    }
  });
  return set;
}

/** Hold `patches` over every refetch until the returned release is called. */
export function holdPatchesAcrossRefetch(
  qc: QueryClient,
  patches: OptimisticPatch[],
): () => void {
  const set = pending.get(qc) ?? subscribe(qc);
  for (const patch of patches) set.add(patch);
  return () => {
    for (const patch of patches) set.delete(patch);
  };
}
