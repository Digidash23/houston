import { FatalResumeError, type ProviderError } from "@houston/runtime-client";
import {
  type ProviderRefusal,
  parseProviderRefusal,
} from "@houston/wire-types";
import { settleProviderErrorCard, type TurnState } from "./turn-settle";

/**
 * The gateway's `provider_account_blocked` send refusal (H-005): the person's
 * credential is intact but the provider blocks the ACCOUNT behind it (GitHub
 * Copilot with billing locked). A sign-in would change nothing, so the turn
 * settles as the `unauthenticated` card with cause `billing_locked`, never
 * as a plain failure line and never as "not connected". Read by code, not by
 * the sentence: the error string is a default for surfaces without copy.
 */

/** The typed refusal behind a failed send (a `409` carrying the code), or null. */
export function providerAccountBlockedRefusal(
  error: unknown,
): ProviderRefusal | null {
  const cause = error instanceof FatalResumeError ? error.cause : error;
  if (!(cause instanceof Error)) return null;
  const { status, body } = cause as { status?: unknown; body?: unknown };
  if (status !== 409) return null;
  let refusal: ProviderRefusal | null;
  if (typeof body === "string") refusal = parseText(body);
  else if (body === undefined) refusal = parseText(cause.message);
  else refusal = parseProviderRefusal(body);
  return refusal?.code === "provider_account_blocked" ? refusal : null;
}

function parseText(text: string): ProviderRefusal | null {
  try {
    return parseProviderRefusal(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * The card for the refusal. Same `unauthenticated` family as a refused
 * not-connected send, with its own cause so the surface never offers a
 * sign-in. The gateway names the provider on the refusal; the caller's own
 * pick is the fallback.
 */
export function accountBlockedCard(
  refusal: ProviderRefusal,
  provider: string | null | undefined,
): ProviderError {
  return {
    kind: "unauthenticated",
    provider: refusal.provider ?? provider ?? "",
    cause: "billing_locked",
    message: refusal.error,
  };
}

/** Settle a send the gateway refused as `provider_account_blocked`. */
export function finishAccountBlocked(
  s: TurnState,
  refusal: ProviderRefusal,
): void {
  if (s.settled) return;
  const card: ProviderError & { failed_prompt?: string } = accountBlockedCard(
    refusal,
    s.provider,
  );
  if (s.prompt) card.failed_prompt = s.prompt;
  settleProviderErrorCard(s, card);
}
