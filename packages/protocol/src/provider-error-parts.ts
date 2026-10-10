/** The detail types a `ProviderError` variant carries (see ./provider-error). */

/**
 * Why an `unauthenticated` provider error happened. Mirrors the frontend
 * `AuthFailureCause` (`@houston-ai/chat`) so the typed reconnect card reads it
 * straight off the wire and picks the right body copy + reconnect lifecycle.
 *
 * - `no_credentials` — never connected (surfaced separately at send time, not
 *   from a live turn).
 * - `token_expired` — the credential lapsed; logging in again recovers it.
 * - `token_revoked` — the provider ended the session server-side (the terminal
 *   session-kill, e.g. Codex `app_session_terminated` / "your session has ended").
 * - `invalid_api_key` — a pasted key the provider rejected.
 * - `org_policy_blocked` — the provider's organization/policy blocked
 *   subscription access for this environment (Anthropic's
 *   `oauth_org_not_allowed`, e.g. subscription OAuth denied from datacenter
 *   IPs). The credential itself is not the problem, so reconnecting does NOT
 *   heal it; the remedy is connecting with an API key instead.
 * - `billing_locked` — the provider blocks the ACCOUNT behind an intact
 *   credential (GitHub Copilot answering its token mint with 403 "billing is
 *   currently locked"). Reconnecting does NOT heal it either; the person fixes
 *   it at the provider or picks another AI. Minted by the SDK from the
 *   gateway's `provider_account_blocked` send refusal, never by a turn.
 */
export type AuthFailureCause =
  | "no_credentials"
  | "token_expired"
  | "token_revoked"
  | "invalid_api_key"
  | "org_policy_blocked"
  | "billing_locked"
  | "unknown";

/**
 * Why a `model_unavailable` provider error happened. Mirrors the frontend
 * `ModelUnavailableReason` (`@houston-ai/chat`) so the wire shape stays
 * assignable to the card's union. The runtime can't always tell the precise
 * sub-reason from the gateway's flat string (GitHub Copilot just says
 * `model_not_supported`), so `unknown` is the common case; the actionable detail
 * is the `suggested_fallback`, not this tag.
 */
export type ModelUnavailableReason =
  | "preview_gated"
  | "deprecated"
  | "region_restricted"
  // Azure OpenAI's DeploymentNotFound: the RESOURCE has no deployment named
  // after the model. Switching models cannot help until the user deploys one
  // (deployment name must equal the model id), so the card must say "deploy
  // it", not "pick another".
  | "not_deployed"
  | "unknown";

/**
 * How a `quota_exhausted` limit is scoped. Mirrors the frontend `QuotaScope`
 * (`@houston-ai/chat`). Informational today — the card copy keys off `resets_at`,
 * not this.
 */
export type QuotaScope = "free_tier" | "paid_plan" | "organization" | "unknown";

/**
 * WHICH credential ran the failed turn. Present only on a managed-cloud turn
 * that carried an acting identity — absent on desktop, self-host, and any turn
 * with no acting identity, where there is exactly one credential and nothing to
 * name.
 *
 * It exists so a failure card can be HONEST about whose account hit the wall
 * (HOU-976): in a team space every turn runs on the acting member's own AI
 * account, so "your Anthropic account is rate limited" is a true sentence and a
 * generic one is not. There is no fallback to offer — a team space has no shared
 * AI credential — so this only names, it never unlocks an action.
 */
export interface ProviderErrorCredential {
  scope: "personal" | "team";
}
