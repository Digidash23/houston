import { isAgentWarmingRefusal } from "./agent-warming-refusal.ts";
import type { OptimisticFailureCopy } from "./optimistic-core.ts";
import { wasToldUser } from "./user-told-mark.ts";

/** Where a refusal goes: the app's reporter and toast store, injected so the
 *  rule is node-testable without the app's Sentry / analytics graph. */
export interface OptimisticRefusalDeps {
  report: (command: string, err: unknown) => void;
  addToast: (toast: OptimisticFailureCopy & { variant: "error" }) => void;
}

/**
 * The refusal surface of every optimistic write. The change the user saw is
 * visibly undone, so silence would read as a glitch: the caller's authored
 * copy says what did not happen. Two refusals already have their surface and
 * get nothing more: one `call()` (`lib/tauri.ts`) explained with its own
 * expected-state copy (last owner, expired trial, offline, waking, a routine
 * that no longer exists), and the warming guard's refusal, whose "almost
 * ready" dialog is already open.
 */
export function createOptimisticRefusal(deps: OptimisticRefusalDeps) {
  return (command: string, err: unknown, copy: OptimisticFailureCopy): void => {
    if (wasToldUser(err) || isAgentWarmingRefusal(err)) return;
    deps.report(command, err);
    deps.addToast({ ...copy, variant: "error" });
  };
}
