import { isPlanMinIntervalRefusal } from "@houston/sdk/routines/plan-floor-quiet";
import { showPlanFloorToast } from "./plan-floor-toast";

/**
 * Expected business state, not a bug: a routine save the engine refused
 * because its schedule fires more often than the saver's plan allows (`400
 * plan_min_interval`, the server half of the editor's own floor). The engine
 * call layer shows the plan's info toast here, once; the caller's own failure
 * handler stands down for it (`routine-write-failure.ts`). True when the error
 * was this refusal and has been surfaced.
 */
export function surfacePlanMinInterval(err: unknown): boolean {
  if (!isPlanMinIntervalRefusal(err)) return false;
  showPlanFloorToast();
  return true;
}
