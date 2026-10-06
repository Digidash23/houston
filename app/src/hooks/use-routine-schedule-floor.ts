import { routineScheduleFloor } from "@houston/sdk";
import { usePlan } from "./queries/use-plan";
import { useSession } from "./use-session";

/**
 * The schedule floor for a routine, from its creator id (SDK
 * `routineScheduleFloor`: the creator's plan decides, so only the creator on
 * Free gets one). Every schedule editor mount AND its save backstop read the
 * floor from here, so the picker and the backstop always agree.
 */
export function useRoutineScheduleFloor(): (
  createdBy: string | undefined,
) => number | undefined {
  const { data: plan } = usePlan();
  const { data: session } = useSession();
  return (createdBy) =>
    routineScheduleFloor(plan, { createdBy, viewerId: session?.uid });
}
