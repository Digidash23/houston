import { planMinIntervalRefusal } from "@houston/sdk/routines/plan-floor-quiet";
import { showPlanFloorToast } from "./plan-floor-toast";

/**
 * Expected business state, not a bug: a routine save the engine refused
 * because its schedule fires more often than the saver's plan allows (`400
 * plan_min_interval`, the server half of the editor's own floor). Shows the
 * plan's info toast, naming the refusal's floor, once; the caller's own
 * failure handler stands down for it (`routine-write-failure.ts`). True when
 * the error was this refusal and has been surfaced. The engine-call layer
 * (`tauri.ts`) and the toast layer's quiet classes both surface through here.
 */
export function surfacePlanMinInterval(err: unknown): boolean {
  const refusal = planMinIntervalRefusal(err);
  if (!refusal) return false;
  showPlanFloorToast(refusal.minIntervalMinutes);
  return true;
}
