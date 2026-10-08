/** The provider pair a turn was started with, exactly as the send named it. */
export interface LiveTurnPin {
  provider: string;
  model?: string;
  effort?: string;
}

/**
 * A programmatic fire's TurnPin (ports.ts) as the live-turn record keeps it:
 * `null`/empty fields are absent, a pin with no provider is no pin at all.
 */
export function liveTurnPin(pin?: {
  provider?: string | null;
  model?: string | null;
  effort?: string | null;
}): LiveTurnPin | undefined {
  if (!pin?.provider) return undefined;
  return {
    provider: pin.provider,
    ...(pin.model ? { model: pin.model } : {}),
    ...(pin.effort ? { effort: pin.effort } : {}),
  };
}
