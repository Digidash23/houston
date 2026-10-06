import { isPlanMinIntervalRefusal } from "@houston/sdk/routines/plan-floor-quiet";

/** What a routine edit's failure handler surfaces through. */
export interface RoutineWriteFailureDeps {
  addToast: (toast: {
    title: string;
    description: string;
    variant: "error";
  }) => void;
  /** Logs + reports the raw failure and returns the generic body
   *  (`genericErrorDescription`). */
  describe: (command: string, err: unknown) => string;
}

/**
 * A routine edit's own failure toast (the routine screen, its model row).
 * The plan-floor refusal is not a failure: the engine-call layer already
 * showed the plan's info toast for it (`plan-min-interval.ts`), so this
 * stands down: no second toast, no report. Anything else gets the authored
 * title with the generic body, reported once.
 */
export function toastRoutineWriteFailure(
  err: unknown,
  failure: { title: string; command: string },
  deps: RoutineWriteFailureDeps,
): void {
  if (isPlanMinIntervalRefusal(err)) return;
  deps.addToast({
    title: failure.title,
    description: deps.describe(failure.command, err),
    variant: "error",
  });
}
