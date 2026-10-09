/**
 * A provider refusing to mint a token because the ACCOUNT behind the
 * credential is blocked, not because the credential is dead. GitHub answers
 * the Copilot token mint with 403 "Your account's billing is currently locked
 * because recent account charges have failed" while the stored GitHub token is
 * valid. This must never sign the user out (a reconnect would succeed and
 * change nothing) and will not heal on retry either: the person fixes billing
 * at the provider. Mirrors the gateway's `credentials.AccountBlockedError`.
 */

export { PROVIDER_ACCOUNT_BLOCKED_CODE } from "@houston/protocol";

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
 * The provider's sentence when a 403 body names a billing lock; null for any
 * other status or body. Only a 403 saying "billing" and "locked" together
 * qualifies: GitHub also 403s for abuse detection and for an account with no
 * Copilot access, and a 401 or 5xx mentioning billing is not this state. Reads
 * GitHub's two shapes, `{"error_details":{"message":…}}` and `{"message":…}`,
 * and falls back to the raw text when the JSON is wrapped in a thrown
 * message's prefix.
 */
export function accountBlockedDetail(
  status: number,
  text: string,
): string | null {
  if (status !== 403) return null;
  const message = providerMessage(text) ?? text;
  const lower = message.toLowerCase();
  if (!lower.includes("billing") || !lower.includes("locked")) return null;
  return message.trim().slice(0, DETAIL_LIMIT);
}

/**
 * The status pi-ai's Copilot mint failure carries: it throws
 * `"<status> <statusText>: <body>"` verbatim. null when the message has no
 * such prefix (a network failure, an invalid-response throw).
 */
export function mintFailureStatus(message: string): number | null {
  const match = /^(\d{3})\b/.exec(message);
  return match ? Number(match[1]) : null;
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
