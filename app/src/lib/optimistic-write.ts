import { useUIStore } from "../stores/ui";
import { isAgentWarmingRefusal } from "./agent-warming-refusal";
import { logAndReportError } from "./error-report";
import {
  type OptimisticFailureCopy,
  type OptimisticWrite,
  runOptimisticWrite,
} from "./optimistic-core";
import { wasToldUser } from "./user-told-mark";

export type {
  OptimisticFailureCopy,
  OptimisticPatch,
  OptimisticWrite,
} from "./optimistic-core";

/**
 * The refusal surface of every optimistic write. The change the user saw is
 * visibly undone, so silence would read as a glitch: the caller's authored
 * copy says what did not happen. Two refusals already have their surface and
 * get nothing more: one `call()` (`lib/tauri.ts`) explained with its own
 * expected-state copy (last owner, expired trial, offline, waking), and the
 * warming guard's refusal, whose "almost ready" dialog is already open.
 */
export function tellOptimisticRefusal(
  command: string,
  err: unknown,
  copy: OptimisticFailureCopy,
): void {
  if (wasToldUser(err) || isAgentWarmingRefusal(err)) return;
  logAndReportError(command, err);
  useUIStore.getState().addToast({ ...copy, variant: "error" });
}

/**
 * Paint a user's create / update / delete in the cache NOW and send it in the
 * background (full contract in `optimistic-core.ts`).
 */
export function optimisticWrite<T>(opts: OptimisticWrite<T>): Promise<void> {
  return runOptimisticWrite(opts, tellOptimisticRefusal, logAndReportError);
}
