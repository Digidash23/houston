import { useUIStore } from "../stores/ui";
import { logAndReportError } from "./error-report";
import { type OptimisticWrite, runOptimisticWrite } from "./optimistic-core";

export type {
  OptimisticFailureCopy,
  OptimisticPatch,
  OptimisticWrite,
} from "./optimistic-core";

/**
 * Paint a user's create / update / delete in the cache NOW and send it in the
 * background (full contract in `optimistic-core.ts`). A refusal rolls the
 * cache back, reaches every reporting path, and tells the user what did not
 * happen with the caller's authored copy: the change they saw is visibly
 * undone, so silence would read as a glitch.
 */
export function optimisticWrite<T>(opts: OptimisticWrite<T>): Promise<void> {
  return runOptimisticWrite(opts, (command, err, copy) => {
    logAndReportError(command, err);
    useUIStore.getState().addToast({ ...copy, variant: "error" });
  });
}
