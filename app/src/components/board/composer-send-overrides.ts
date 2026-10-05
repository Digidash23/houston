import type { ModelPin } from "../../lib/model-selector-lock";
import type { TurnMode } from "../../lib/turn-mode";
import type { SendOverrides } from "./board-source";

/**
 * The provider/model/effort a composer send carries, from the pin the picker
 * shows. Every chat surface that sends through the board queue (agent boards,
 * Mission Control, the assistant, setup chats) builds its overrides here, so
 * effort can't fall off one surface the way it once fell off every typed send.
 */
export function composerSendOverrides(
  pin: ModelPin,
  modeOverride: TurnMode,
): SendOverrides {
  return { ...pinOverrides(pin), modeOverride };
}

/**
 * `overrides` re-pinned to the pin settled at SEND time (PRODUCT-1771): the
 * settled provider, model AND effort replace the ones the composer rendered,
 * while the mode, mentions and grants ride through unchanged.
 */
export function settleOnPin(
  overrides: SendOverrides,
  pin: ModelPin,
): SendOverrides {
  return { ...overrides, ...pinOverrides(pin) };
}

function pinOverrides(
  pin: ModelPin,
): Pick<
  SendOverrides,
  "providerOverride" | "modelOverride" | "effortOverride"
> {
  return {
    providerOverride: pin.provider,
    modelOverride: pin.model,
    effortOverride: pin.effort,
  };
}
