// The one securetoken round trip behind `refreshNow`, with the check that the
// answer is a token the gateway will still accept.
//
// Why the check exists: `expires_in` is relative to the moment the answer is
// READ. On an awake machine that is milliseconds after the request was SENT.
// It is the length of a sleep when the request went out, the lid closed, and
// the webview delivered the buffered answer on wake: the session then looks an
// hour fresh while the token expired during the sleep, and every caller joined
// to that in-flight run replays a bearer the gateway refuses (HOUSTON-APP-5HZ).
//
// Staleness is measured with the client's own clock only, never against the
// token's `exp` claim: a client clock an hour ahead of Google's would make
// every honest token look expired and spin the proactive timer against
// securetoken. The request duration is the one quantity a skewed clock cannot
// distort, so expiry is dated from the SEND, and an answer whose remaining
// lifetime is already gone by the time it is read is minted once more.

import { identityConfig } from "./config.ts";
import type { TokenSignInResult } from "./firebase-rest.ts";
import { refreshIdToken } from "./firebase-rest.ts";
import { identityLog } from "./log.ts";

/** A token with this much lifetime left, or less, is refused before a replay
 *  can land. */
export const MIN_REMAINING_MS = 60_000;

/**
 * Date a minted token's expiry from when its request was SENT. `minted.expiresAt`
 * counts `expires_in` from the read (`firebase-rest.ts`); shifting it back by
 * the request's wall-clock duration is the conservative, skew-proof value.
 */
export function expiresAtFromSend(
  startedAtMs: number,
  minted: TokenSignInResult,
  readAtMs: number,
): number {
  return minted.expiresAt - (readAtMs - startedAtMs);
}

/** Whether a token expiring at `expiresAtMs` is already unusable at `nowMs`. */
export function isSleptOut(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs - nowMs <= MIN_REMAINING_MS;
}

async function mintOnce(refreshToken: string): Promise<TokenSignInResult> {
  const startedAt = Date.now();
  const minted = await refreshIdToken({
    apiKey: identityConfig.apiKey,
    refreshToken,
  });
  return {
    ...minted,
    expiresAt: expiresAtFromSend(startedAt, minted, Date.now()),
  };
}

/**
 * Redeem `refreshToken` for an idToken that is usable NOW. An answer that
 * outlived its own lifetime in flight (the sleep shape above) earns exactly one
 * more mint, with the refresh token that answer carried. A second mint that
 * fails rethrows like any refresh (the caller keeps the stored session on a
 * transient failure); a second answer is returned as is.
 */
export async function mintUsableIdToken(
  refreshToken: string,
): Promise<TokenSignInResult> {
  const first = await mintOnce(refreshToken);
  if (!isSleptOut(first.expiresAt, Date.now())) return first;
  identityLog(
    "warn",
    `refresh answer outlived its token in flight (${Math.round((Date.now() - first.expiresAt) / 1000)}s past expiry on read); minting again`,
    "identity/refresh",
  );
  return mintOnce(first.refreshToken);
}
