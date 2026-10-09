import type { ProviderError } from "@houston-ai/chat";
import type { AuthCardPresentation } from "./auth-presentation.ts";

type UnauthCause = Extract<ProviderError, { kind: "unauthenticated" }>["cause"];

const K = "providerError.unauthenticated";

/**
 * A cause a sign-in cannot heal, so the card never launches one and offers a
 * remedy on the AI Hub instead: an API key for a provider's policy block
 * (`org_policy_blocked`, PRODUCT-1393); another AI for a provider that locked
 * the account's billing behind an intact credential (`billing_locked`, GitHub
 * Copilot, H-005), while the person fixes the payment at the provider.
 */
export type UnhealableCause = Extract<
  UnauthCause,
  "org_policy_blocked" | "billing_locked"
>;

export function unhealableCause(
  cause: UnauthCause,
): UnhealableCause | undefined {
  return cause === "org_policy_blocked" || cause === "billing_locked"
    ? cause
    : undefined;
}

/**
 * The card for an unhealable cause, idle and failed alike: a reconnect can
 * only hit the same wall, so a stray login failure elsewhere must not swap in
 * the "sign-in did not finish" body over the honest one.
 */
export function unhealablePresentation(
  cause: UnhealableCause,
): AuthCardPresentation {
  if (cause === "org_policy_blocked") {
    return {
      variant: "active",
      titleKey: `${K}.titleOrgPolicy`,
      bodyKey: `${K}.bodyOrgPolicyBlocked`,
      button: {
        kind: "action",
        labelKey: `${K}.useApiKey`,
        action: "open_ai_hub",
      },
    };
  }
  return {
    variant: "active",
    titleKey: `${K}.titleBillingLocked`,
    bodyKey: `${K}.bodyBillingLocked`,
    button: {
      kind: "action",
      labelKey: `${K}.chooseAnotherAi`,
      action: "open_ai_hub",
    },
  };
}
