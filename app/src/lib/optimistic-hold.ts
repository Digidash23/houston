import {
  matchQuery,
  type QueryCacheNotifyEvent,
  type QueryClient,
} from "@tanstack/react-query";
import type { OptimisticPatch } from "./optimistic-core";

/**
 * The patches of every optimistic write still in flight, per client. A fetch
 * that lands while a write is pending carries the host's PRE-write truth (a
 * deleted card still listed), so each landing fetch on a matching key gets
 * the pending patches re-applied over it. Without this, any unrelated event
 * refetching the board mid-delete resurrects the card until the delete's own
 * event refetches again.
 */
const pending = new WeakMap<QueryClient, Set<OptimisticPatch>>();

function subscribe(qc: QueryClient): Set<OptimisticPatch> {
  const set = new Set<OptimisticPatch>();
  pending.set(qc, set);
  qc.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
    if (set.size === 0 || event.type !== "updated") return;
    // `manual` marks a setQueryData write: ours (re-applying would loop) or a
    // caller's deliberate edit. Only a fetch result carries stale truth.
    if (event.action.type !== "success" || event.action.manual) return;
    const { query } = event;
    for (const patch of set) {
      if (!matchQuery({ queryKey: patch.queryKey }, query)) continue;
      qc.setQueryData(query.queryKey, patch.apply(query.state.data));
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
