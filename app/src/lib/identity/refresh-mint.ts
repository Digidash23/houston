// The one securetoken round trip behind `refreshNow`, with the check that the
// answer is a token the gateway will still accept.
//
// Why the check exists: `expires_in` is relative to the moment the answer is
// READ, while the token's `exp` claim is absolute. Those agree to the second
// on an awake machine. They disagree by the length of a sleep when the request
// went out, the lid closed, and the webview delivered the buffered answer on
// wake: the session then looks an hour fresh while the token expired during
// the sleep, and every caller joined to that in-flight run replays a bearer
// the gateway refuses (HOUSTON-APP-5HZ). So an answer already expired by its
// own claims is never handed out: the run mints once more, after the wake,
// and the joiners receive that one.

import { identityConfig } from "./config.ts";
import type { TokenSignInResult } from "./firebase-rest.ts";
import { refreshIdToken } from "./firebase-rest.ts";
import { idTokenExpiresAtMs } from "./id-token.ts";
import { identityLog } from "./log.ts";

/** A token this close to `exp` is refused before a replay can land. */
const MIN_REMAINING_MS = 60_000;

/** Whether `idToken` is expired, or about to be, by its own `exp` claim. A
 *  token without a readable claim is trusted: the gateway is the judge. */
export function isSleptOut(
  idToken: string,
  nowMs: number = Date.now(),
): boolean {
  const exp = idTokenExpiresAtMs(idToken);
  return exp !== null && exp - nowMs <= MIN_REMAINING_MS;
}

/**
 * Redeem `refreshToken` for an idToken that is usable NOW. One answer expired
 * by its claims earns exactly one more mint; the second answer is returned as
 * is (a client clock hours ahead of Google's makes every token look expired,
 * and the gateway, not this check, decides those). The returned `expiresAt`
 * never outlives the token's own `exp`, so the proactive timer schedules off
 * the honest value instead of waiting an hour on a dead token.
 */
export async function mintUsableIdToken(
  refreshToken: string,
): Promise<TokenSignInResult> {
  const params = { apiKey: identityConfig.apiKey, refreshToken };
  let minted = await refreshIdToken(params);
  if (isSleptOut(minted.idToken)) {
    const exp = idTokenExpiresAtMs(minted.idToken);
    identityLog(
      "warn",
      `refresh answered a token already expired by its claims (exp ${exp === null ? "?" : Math.round((exp - Date.now()) / 1000)}s from now); minting again`,
      "identity/refresh",
    );
    minted = await refreshIdToken(params);
  }
  const exp = idTokenExpiresAtMs(minted.idToken);
  return exp === null
    ? minted
    : { ...minted, expiresAt: Math.min(minted.expiresAt, exp) };
}
