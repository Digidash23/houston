import { routineScheduleFloor } from "@houston/sdk";
import { usePlan } from "./queries/use-plan";

/**
 * The schedule floor for any save this person makes (SDK
 * `routineScheduleFloor`: their own plan decides, since every save re-stamps
 * the routine's creator to them). Every schedule editor mount AND its save
 * backstop read the floor from here, so the picker and the backstop always
 * agree.
 */
export function useRoutineScheduleFloor(): number | undefined {
  const { data: plan } = usePlan();
  return routineScheduleFloor(plan);
}
