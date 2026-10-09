import type { ProviderError } from "@houston-ai/chat";

type UnauthCause = Extract<ProviderError, { kind: "unauthenticated" }>["cause"];

/**
 * A cause a sign-in cannot heal, so the card never launches one and offers a
 * remedy on the AI Hub instead: an API key for a provider's policy block
 * (`org_policy_blocked`, PRODUCT-1393); another AI for an account the provider
 * blocked behind an intact credential (`account_blocked`, GitHub Copilot with
 * billing locked, H-005), while the person fixes billing at the provider.
 */
export type UnhealableCause = Extract<
  UnauthCause,
  "org_policy_blocked" | "account_blocked"
>;

export function unhealableCause(
  cause: UnauthCause,
): UnhealableCause | undefined {
  return cause === "org_policy_blocked" || cause === "account_blocked"
    ? cause
    : undefined;
}
