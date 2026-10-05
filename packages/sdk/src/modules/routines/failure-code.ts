import type {
  RoutineDeliveryFailureCode,
  RoutineRun,
  RoutineRunFailureCode,
} from "@houston/protocol";

/** Delivery expiry stays separate from failures that can auto-pause a routine. */
export function routineFailureCode(
  run: Pick<RoutineRun, "delivery_failure" | "failure">,
): RoutineDeliveryFailureCode | RoutineRunFailureCode | undefined {
  return run.delivery_failure?.code ?? run.failure?.code;
}
