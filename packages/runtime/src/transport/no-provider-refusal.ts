import { savedActiveProvider } from "../ai/providers";

/**
 * The 409 body for an unpinned turn with no usable provider. `code` is the
 * machine-readable half: the host's scheduler reads it to demote a routine
 * firing into this expected user state to a warning instead of a Sentry error
 * (HOUSTON-APP-4XM). `provider` names the agent's saved provider when one is
 * saved (logged out, or its login expired), so a routine run blames that
 * account and offers its reconnect; it is absent only when nothing is saved
 * (PRODUCT-1982).
 */
export function noProviderRefusal(): {
  error: string;
  code: "no_provider";
  provider?: string;
} {
  const saved = savedActiveProvider();
  return {
    error: "No provider connected. Connect an AI provider first.",
    code: "no_provider",
    ...(saved ? { provider: saved } : {}),
  };
}
