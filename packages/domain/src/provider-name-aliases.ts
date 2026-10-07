/**
 * Legacy / spoken provider name → canonical pi ProviderId, keyed LOWERCASE.
 *
 * Two sources, one table. The DIALECT half comes from `provider-dialect.ts` —
 * Houston's display id for a provider IS a name a user or an agent will write,
 * and restating it here is how the two drifted. The rest are the short names a
 * user actually says for a provider whose pi id is longer ("gemini", "bedrock",
 * "copilot") plus the CLI era's informal ones ("codex", "chatgpt") — resolving
 * them here is what keeps an agent from GUESSING an id (`provider-choice.ts`).
 * Everything else is either already a pi id (handled separately) or unknown.
 *
 * The hosted gateway mirrors this table: it looks a routine's pinned provider
 * up under the id this table maps it to before it fetches the creator's
 * credential, and a pin it cannot map falls back instead of running. Change
 * the gateway's copy in the same sitting as this one
 * (`provider-name-aliases.test.ts` pins the full table).
 */

import { PROVIDER_CANONICAL_RENAME } from "./provider-dialect";
import type { ProviderId } from "./provider-ids";

/** Spoken/legacy names that are NOT a Houston display id. */
const SPOKEN_ALIASES: Readonly<Record<string, ProviderId>> = {
  codex: "openai-codex",
  chatgpt: "openai-codex",
  claude: "anthropic",
  gemini: "google",
  bedrock: "amazon-bedrock",
  copilot: "github-copilot",
};

export const PROVIDER_ALIASES: Readonly<Record<string, ProviderId>> = {
  ...PROVIDER_CANONICAL_RENAME,
  ...SPOKEN_ALIASES,
};
