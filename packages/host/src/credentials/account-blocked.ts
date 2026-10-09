/**
 * A provider refusing to mint a token because the ACCOUNT behind the
 * credential is blocked, not because the credential is dead. GitHub answers
 * the Copilot token mint with 403 "Your account's billing is currently locked
 * because recent account charges have failed" while the stored GitHub token is
 * valid. This must never sign the user out (a reconnect would succeed and
 * change nothing) and will not heal on retry either: the person fixes billing
 * at the provider. Mirrors the gateway's `credentials.AccountBlockedError`.
 */

/**
 * The `code` on the pod-facing 502 for this state, minted by the gateway's
 * credential serve and by this host's own sandbox serve alike, so the runtime
 * and the pool dispatcher read one shape.
 */
export const PROVIDER_ACCOUNT_BLOCKED_CODE = "provider_account_blocked";

/** How many characters of the provider's sentence a surface is handed. */
const DETAIL_LIMIT = 200;

export class ProviderAccountBlockedError extends Error {
  constructor(
    readonly provider: string,
    /** The provider's own sentence about the block, without JSON around it. */
    readonly detail: string,
  ) {
    super(`provider account blocked for ${provider}: ${detail}`);
    this.name = "ProviderAccountBlockedError";
  }
}

/**
 * The provider's sentence when `text` (a response body, or a thrown mint
 * error carrying one) names a billing lock; null otherwise. Only "billing" and
 * "locked" together qualify: GitHub also 403s for abuse detection and for an
 * account with no Copilot access, neither of which is this state. Reads
 * GitHub's two shapes, `{"error_details":{"message":…}}` and `{"message":…}`,
 * and falls back to the raw text when the JSON is wrapped in a thrown
 * message's prefix.
 */
export function accountBlockedDetail(text: string): string | null {
  const message = providerMessage(text) ?? text;
  const lower = message.toLowerCase();
  if (!lower.includes("billing") || !lower.includes("locked")) return null;
  return message.trim().slice(0, DETAIL_LIMIT);
}

function providerMessage(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let parsed: {
    message?: unknown;
    error_details?: { message?: unknown } | null;
  };
  try {
    parsed = JSON.parse(text.slice(start)) as typeof parsed;
  } catch {
    return null;
  }
  const nested = parsed.error_details?.message;
  if (typeof nested === "string" && nested !== "") return nested;
  return typeof parsed.message === "string" && parsed.message !== ""
    ? parsed.message
    : null;
}
