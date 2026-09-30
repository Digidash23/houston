import type { Routine } from "@houston/engine-adapter";
import { routineFirePin } from "@houston/sdk";
import { toDisplayProviderIdOrNull } from "./provider-overrides";

/** A routine's own provider/model pin, keyed by the display provider id. */
export interface RoutinePinnedPair {
  /** `""` when the routine carries no provider pin. */
  provider: string;
  /** `""` when the routine carries no model pin, or the fire path drops it. */
  model: string;
}

/**
 * The provider/model pin a routine's fired turn carries, keyed by the display
 * id the picker, the label chain and the health probe read. routines.json
 * stores whatever was written; the fire path reads it through
 * `routineFirePin`, so a retired id shows the model it fires on and a model
 * that ladder drops shows no model pin at all (the agent's model runs).
 */
export function routinePinnedPair(
  routine: Pick<Routine, "provider" | "model">,
): RoutinePinnedPair {
  const pin = routineFirePin(routine);
  return {
    provider: toDisplayProviderIdOrNull(pin.provider) ?? "",
    model: pin.model ?? "",
  };
}
