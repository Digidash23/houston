import {
  type RoutineScheduleFloor,
  routineScheduleFloor,
  scheduleFloorRule,
} from "@houston/sdk";
import { useMemo } from "react";
import { usePlan } from "./queries/use-plan";

/**
 * The schedule floor for any save this person makes (SDK
 * `routineScheduleFloor`: their own plan decides, since every save re-stamps
 * the routine's creator to them), bound to the SDK's one rule
 * (`scheduleFloorRule`). Every schedule editor mount AND its save backstop
 * read it from here: the editor offers only what `allows` accepts and the
 * backstop asks the same `allows`, so the two always agree. Memoized on the
 * minutes, so the editor's scan of the counts it offers runs once per plan.
 */
export function useRoutineScheduleFloor(): RoutineScheduleFloor | undefined {
  const { data: plan } = usePlan();
  const minutes = routineScheduleFloor(plan);
  return useMemo(
    () => (minutes === undefined ? undefined : scheduleFloorRule(minutes)),
    [minutes],
  );
}
