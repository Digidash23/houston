import { useUIStore } from "../stores/ui";
import { logAndReportError } from "./error-report";
import { type OptimisticWrite, runOptimisticWrite } from "./optimistic-core";
import { createOptimisticRefusal } from "./optimistic-refusal";

export type {
  OptimisticFailureCopy,
  OptimisticPatch,
  OptimisticWrite,
} from "./optimistic-core";

/** The refusal surface of every optimistic write (`optimistic-refusal.ts`). */
export const tellOptimisticRefusal = createOptimisticRefusal({
  report: logAndReportError,
  addToast: (toast) => useUIStore.getState().addToast(toast),
});

/**
 * Paint a user's create / update / delete in the cache NOW and send it in the
 * background (full contract in `optimistic-core.ts`).
 */
export function optimisticWrite<T>(opts: OptimisticWrite<T>): Promise<void> {
  return runOptimisticWrite(opts, tellOptimisticRefusal, logAndReportError);
}
