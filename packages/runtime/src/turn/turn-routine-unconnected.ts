import { savedActiveProviderIn } from "./op-settings";
import { turnIsUnconnected } from "./turn-request";
import type { TurnRequest } from "./types";

/**
 * What a pooled routine turn with no credential would have run on, for its
 * typed failure (`finishRoutineTurn`): the turn's provider (the routine's pin
 * or the one the turn was sent with), else the agent's saved provider in the
 * hydrated settings.json (logged out, or its login expired). `{}` when nothing
 * names one, which reads as "no model chosen" (PRODUCT-1982). Undefined when
 * the turn had a credential: it reached a provider, and its own outcome says
 * how it went. Same rule as the standing host's 409 `no_provider` body.
 */
export function unconnectedRoutineTurn(
  turn: Pick<TurnRequest, "credential">,
  provider: string | undefined,
  dataDir: string,
): { provider?: string } | undefined {
  if (!turnIsUnconnected(turn)) return undefined;
  const named = provider || savedActiveProviderIn(dataDir);
  return named ? { provider: named } : {};
}
