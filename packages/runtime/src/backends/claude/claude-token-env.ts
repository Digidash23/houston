import { isPersonalClaudePlan } from "../../auth/claude-plan";
import type { ClaudeToken } from "./backend-types";

/**
 * The single Anthropic auth env var for a credential (empty when none is
 * connected): a setup/OAuth token via `CLAUDE_CODE_OAUTH_TOKEN`, an API key via
 * `ANTHROPIC_API_KEY`.
 *
 * An env OAuth token tells the CLI nothing about its plan, so the CLI treats
 * it like an organization login and blocks every startup on the managed
 * settings and policy limits fetches. `CLAUDE_CODE_SUBSCRIPTION_TYPE` is the
 * CLI's own channel for that fact (its background sessions hand the plan over
 * the same way); it is set only for a known personal plan, so a Team or
 * Enterprise login keeps fetching its admins' policy.
 */
export function tokenEnv(
  token: ClaudeToken | undefined,
): Record<string, string> {
  if (token?.kind === "oauth-token")
    return {
      CLAUDE_CODE_OAUTH_TOKEN: token.value,
      ...(isPersonalClaudePlan(token.subscriptionType)
        ? { CLAUDE_CODE_SUBSCRIPTION_TYPE: token.subscriptionType }
        : {}),
    };
  if (token?.kind === "api-key") return { ANTHROPIC_API_KEY: token.value };
  return {};
}
