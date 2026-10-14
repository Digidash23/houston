/**
 * Every env var the Claude Agent SDK reads to authenticate. The SDK honors all
 * three (verified in the installed `sdk.mjs`): a setup/OAuth token via
 * `CLAUDE_CODE_OAUTH_TOKEN`, and an API key via either `ANTHROPIC_API_KEY` or
 * the `ANTHROPIC_AUTH_TOKEN` alias. We never copy these from the ambient env;
 * exactly the one for the connected credential is set, so exactly one survives.
 */
export const CREDENTIAL_ENV_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  // Not a secret, but a fact about the credential: never inherited.
  "CLAUDE_CODE_SUBSCRIPTION_TYPE",
] as const;
