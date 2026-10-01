// `.ts` extensions so the node test runner can import this module directly.
import type { ProviderConnectionState } from "../../../lib/provider-connection.ts";

/**
 * A provider's state as the first-run connect card shows it while the AI's
 * home is still starting up (a new account's first probe can wait seconds on
 * it). Nothing can have been connected there yet, so "checking" reads as not
 * connected and the card offers Connect at once; a press waits for the probe
 * to answer before it starts, and a provider the probe finds connected moves
 * onboarding on by itself. Once the probe has answered, its states stand.
 */
export function optimisticConnectionState(
  state: ProviderConnectionState,
  probeSettled: boolean,
): ProviderConnectionState {
  return !probeSettled && state === "checking" ? "disconnected" : state;
}
