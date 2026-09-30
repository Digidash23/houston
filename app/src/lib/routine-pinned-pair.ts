import type { Routine } from "@houston/engine-adapter";
import { routineFirePin } from "@houston/sdk";
import { DEFAULT_MODEL } from "@houston/sdk/provider-catalog";
import { toDisplayProviderIdOrNull } from "./provider-overrides";

/** A routine's own provider/model pin, keyed by the display provider id. */
export interface RoutinePinnedPair {
  /** `""` when the routine carries no provider pin. */
  provider: string;
  /** `""` only when the routine carries no provider pin. */
  model: string;
}

/**
 * The provider/model pin a routine's fired turn carries, keyed by the display
 * id the picker, the label chain and the health probe read. routines.json
 * stores whatever was written; the fire path reads it through
 * `routineFirePin`, so a retired id shows the model it fires on. A provider
 * pin whose model that ladder drops (or that stores none) still fires on its
 * provider, which runs its own default, so the screen names that default —
 * never the agent's pair, which may be another lab entirely.
 */
export function routinePinnedPair(
  routine: Pick<Routine, "provider" | "model">,
): RoutinePinnedPair {
  const pin = routineFirePin(routine);
  const provider = toDisplayProviderIdOrNull(pin.provider) ?? "";
  if (!provider) return { provider, model: pin.model ?? "" };
  const fallback = pin.provider ? DEFAULT_MODEL[pin.provider] : undefined;
  return { provider, model: pin.model ?? fallback ?? "" };
}
