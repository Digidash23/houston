import { turnHydrationError } from "./turn-hydration-error";

/** Why the deferred set stopped when the prompt no longer needed it. */
export class DeferredFilesAbandonedError extends Error {
  constructor() {
    super("the turn ended before its files were needed");
    this.name = "DeferredFilesAbandonedError";
  }
}

/** Store reads of the deferred set, each bounded (read-timeout.ts). */
export const DEFERRED_READ_TIMEOUT_MS = 120_000;
/** Deferred reads in flight at once: below the critical set's, since they
 *  buffer batches while the harness starts beside them. */
export const DEFERRED_PARALLEL = 2;

/**
 * Watch the deferred files of one turn: mark when they land (`t_files_ready`)
 * or fail (`t_deferred_failed`, reported once), and let the end of the prompt
 * abandon them. Abandoning is a no-op once they landed; before that, no tool
 * can have run (every tool waits for `workspaceReady`), so stopping the
 * download and syncing as after a failed one touches nothing of the person's.
 * The `landed` reaction is the first one on `deferred`, so it is set before
 * any tool's gate can pass.
 */
export function watchDeferredFiles(
  deferred: Promise<void>,
  abort: (reason: unknown) => void,
  timings?: Record<string, number>,
): { workspaceReady: Promise<void>; abandonDeferred: () => void } {
  let landed = false;
  let abandoned = false;
  const workspaceReady = deferred.then(
    () => {
      landed = true;
      if (timings) timings.t_files_ready = performance.now();
    },
    (error: unknown) => {
      if (error instanceof DeferredFilesAbandonedError) {
        if (timings) timings.t_files_abandoned = performance.now();
        throw error;
      }
      if (timings) timings.t_deferred_failed = performance.now();
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[turn] deferred_files_failed cause=${detail}`);
      throw turnHydrationError(error);
    },
  );
  return {
    workspaceReady,
    abandonDeferred() {
      if (landed || abandoned) return;
      abandoned = true;
      abort(new DeferredFilesAbandonedError());
    },
  };
}
