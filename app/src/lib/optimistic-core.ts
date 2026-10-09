import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { holdPatchesAcrossRefetch } from "./optimistic-hold";

/**
 * One cache edit an optimistic write paints before the host answers.
 * `queryKey` matches by PREFIX (TanStack's `setQueriesData` filter), so
 * `["all-conversations"]` reaches every roster variant of the aggregate.
 * `apply` must be idempotent and must tolerate `undefined` (a cache entry
 * that never loaded): it is re-run on every refetch that lands while the
 * write is still in flight.
 */
export interface OptimisticPatch<D = unknown> {
  queryKey: QueryKey;
  // Method syntax on purpose: its parameter is bivariant, so a patch typed
  // for one cache shape still fits the `OptimisticPatch[]` list.
  apply(current: D | undefined): D | undefined;
}

/** What the user reads if the host refuses: authored `t()` copy, never `err.message`. */
export interface OptimisticFailureCopy {
  title: string;
  description: string;
}

export interface OptimisticWrite<T> {
  qc: QueryClient;
  /** Sentry / log tag for a refused write, e.g. "delete_mission". */
  command: string;
  patches: OptimisticPatch[];
  write: () => Promise<T>;
  failure: OptimisticFailureCopy;
  /** Keys refreshed from the host once the write settles. Defaults to every patch key. */
  invalidate?: QueryKey[];
  /** Runs after a successful write (cleanup that must wait for the host, e.g. drafts). */
  onSuccess?: (result: T) => void;
  /** Runs after the rollback, for state outside the query cache (a cleared selection). */
  onError?: (err: unknown) => void;
}

/**
 * The engine of `optimisticWrite` (`optimistic-write.ts`), with the
 * refusal surface injected so it is unit-tested without the app's reporters.
 *
 * Paint a write's outcome NOW and send it in the background. The UI never
 * waits on the host: the cache is edited synchronously, the write goes out,
 * and only a refusal is visible later, as a rollback plus one authored toast.
 *
 * Returns a promise that settles when the write does and NEVER rejects (the
 * failure is already handled), so a caller can ignore it without leaving a
 * floating rejection, or await it when a follow-up genuinely needs the host's
 * answer.
 *
 * While the write is in flight, a refetch that lands (another event, a window
 * focus) would repaint the pre-write truth: `holdPatchesAcrossRefetch` re-runs
 * the patches over it until the write settles.
 */
export function runOptimisticWrite<T>(
  opts: OptimisticWrite<T>,
  refused: (command: string, err: unknown, copy: OptimisticFailureCopy) => void,
): Promise<void> {
  const { qc, patches } = opts;
  const snapshots = patches.flatMap((patch) => {
    // A refetch already in flight would land the pre-write list over the
    // paint. Cancel is synchronous in effect; the promise only reports it.
    void qc.cancelQueries({ queryKey: patch.queryKey });
    const before = qc.getQueriesData({ queryKey: patch.queryKey });
    qc.setQueriesData({ queryKey: patch.queryKey }, patch.apply);
    return before;
  });
  const release = holdPatchesAcrossRefetch(qc, patches);
  const refresh = () => {
    for (const queryKey of opts.invalidate ?? patches.map((p) => p.queryKey)) {
      void qc.invalidateQueries({ queryKey });
    }
  };

  return opts.write().then(
    (result) => {
      release();
      refresh();
      opts.onSuccess?.(result);
    },
    (err: unknown) => {
      release();
      for (const [queryKey, data] of snapshots) qc.setQueryData(queryKey, data);
      refresh();
      refused(opts.command, err, opts.failure);
      opts.onError?.(err);
    },
  );
}
