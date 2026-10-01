import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Refresh a query after a write the server has acknowledged. A plain
 * invalidation is not enough: while the query has no data yet, TanStack folds
 * it into the read already in flight, which began before the write, so the
 * write never shows. Cancelling that read first makes the refetch start after
 * the write.
 */
export async function refetchAfterWrite(
  qc: QueryClient,
  queryKey: QueryKey,
): Promise<void> {
  await qc.cancelQueries({ queryKey });
  await qc.invalidateQueries({ queryKey });
}
