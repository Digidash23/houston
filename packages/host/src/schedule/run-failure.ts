import type { ProviderError, RoutineRunFailure } from "@houston/protocol";
import { sentenceProviderName } from "../providers";

// The classification is pure and shared with the pooled worker's settle.
export { routineRunFailure } from "@houston/domain";

/**
 * Why a routine run failed, in the terms the person reading its history can
 * act on (PRODUCT-1475). A routine fires on the CREATOR's credential scope, so
 * "no provider connected" is never the whole truth: the reader may well have
 * their own account connected and still see the run fail, which is exactly the
 * report that made this bug look like a lie on screen.
 *
 * The typed code drives whatever the surface wants to render; `summary` stays
 * an honest English sentence for the surfaces (and the run history) that show
 * it verbatim, matching the existing run-row copy.
 */

/** The run-row sentence for a typed failure. */
export function routineRunFailureSummary(failure: RoutineRunFailure): string {
  const name = sentenceProviderName(failure.provider);
  switch (failure.code) {
    case "creator_not_connected":
      return `The routine's creator has no ${name} account connected.`;
    case "team_not_connected":
      return `This team has no ${name} account connected.`;
    case "creator_needs_reconnect":
      return `${name} needs to be reconnected by the routine's creator.`;
    case "team_needs_reconnect":
      return `${name} needs to be reconnected for this team.`;
    case "out_of_credits":
      return `The ${name} account is out of credits.`;
    case "model_unavailable":
      return `The ${name} account can't use the model this routine runs on.`;
  }
}

/** A run-row-sized reason from a turn's typed provider failure that is NOT a
 *  credential wall (an outage, a rate limit): the provider's own words. */
export function providerErrorSummary(err: ProviderError): string {
  const text = err.kind === "unknown" ? err.raw_excerpt : err.message;
  return text.trim() || `provider error (${err.kind})`;
}
