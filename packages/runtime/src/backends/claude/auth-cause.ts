import type { AuthFailureCause } from "@houston/runtime-client";

/**
 * A minimal auth-cause read off an authentication failure's text. The full
 * pattern set lives (unexported) in `ai/provider-error.ts`; here the SDK has
 * already decided it is auth, so only the recover-vs-reconnect distinction is
 * needed to pick the card's body copy.
 */
export function authCause(lower: string): AuthFailureCause {
  if (
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("incorrect api key")
  )
    return "invalid_api_key";
  if (
    lower.includes("revoked") ||
    lower.includes("session has ended") ||
    lower.includes("session terminated") ||
    lower.includes("log in again")
  )
    return "token_revoked";
  if (lower.includes("expired")) return "token_expired";
  return "unknown";
}
