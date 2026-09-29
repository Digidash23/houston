import type { ClaudePlanBinding } from "../../auth/claude-plan";
import type { ClaudeToken } from "./backend-types";

/**
 * Attach the plan the gateway served with a token, when the resolved token IS
 * that token. The credential chain (`./read-token`) may resolve a different
 * one (a stored login, the shared login dir), and a plan names the login it
 * was read from, so any other token runs with no plan, exactly as before.
 */
export function withServedPlan(
  token: ClaudeToken | undefined,
  plan: ClaudePlanBinding | undefined,
): ClaudeToken | undefined {
  if (
    token?.kind !== "oauth-token" ||
    !plan ||
    token.accessDigest !== plan.accessDigest
  )
    return token;
  return { ...token, subscriptionType: plan.subscriptionType };
}
