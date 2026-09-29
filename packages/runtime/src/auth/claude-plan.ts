import { accessDigest } from "@houston/protocol/access-digest";

/**
 * A Claude subscription login's plan, in the Claude Code CLI's own vocabulary
 * (`CLAUDE_CODE_SUBSCRIPTION_TYPE`). The gateway resolves it from the served
 * access token's Anthropic profile and ships it on the pooled turn's
 * credential; absent means unknown.
 */
export const CLAUDE_SUBSCRIPTION_TYPES = [
  "pro",
  "max",
  "team",
  "enterprise",
] as const;

export type ClaudeSubscriptionType = (typeof CLAUDE_SUBSCRIPTION_TYPES)[number];

/** A wire value as a plan, or undefined for anything the CLI would not know. */
export function parseClaudeSubscriptionType(
  value: unknown,
): ClaudeSubscriptionType | undefined {
  return CLAUDE_SUBSCRIPTION_TYPES.find((plan) => plan === value);
}

/**
 * Whether the CLI may be told this plan. Only a personal plan: the CLI skips
 * the organization's managed-settings and policy-limits fetches for Pro and
 * Max, and those are exactly what a Team or Enterprise admin's policy rides.
 * Naming a Team or Enterprise plan would change nothing that matters here and
 * everything else the CLI keys on the plan, so those stay unnamed, like an
 * unknown plan.
 */
export function isPersonalClaudePlan(
  plan: ClaudeSubscriptionType | undefined,
): plan is "pro" | "max" {
  return plan === "pro" || plan === "max";
}

/**
 * The plan the gateway served WITH one access token. A plan describes the
 * token it arrived with and nothing else, so it is bound to that token's
 * digest: a turn whose credential chain resolves any other token (a stored
 * login, the shared login dir) runs with no plan at all.
 */
export interface ClaudePlanBinding {
  accessDigest: string;
  subscriptionType: ClaudeSubscriptionType;
}

/** Bind a served credential's plan to its token, when it carries one. */
export function claudePlanBinding(
  credential:
    | {
        provider: string;
        access: string;
        kind?: "oauth" | "api_key";
        subscriptionType?: ClaudeSubscriptionType;
      }
    | null
    | undefined,
): ClaudePlanBinding | undefined {
  if (
    credential?.provider !== "anthropic" ||
    credential.kind === "api_key" ||
    !credential.subscriptionType
  )
    return undefined;
  return {
    accessDigest: accessDigest(credential.access),
    subscriptionType: credential.subscriptionType,
  };
}
