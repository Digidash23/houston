import type { Options } from "@anthropic-ai/claude-agent-sdk";

/**
 * The options every Houston `query()` carries, turn and one-shot alike.
 *
 * `settingSources: []` keeps the host machine's own Claude settings out of
 * Houston's subprocess. `title` names the session up front: without one the
 * CLI fires a Haiku `generate_session_title` request (billed to the user's
 * plan) inside the startup of every new session. Houston titles conversations
 * itself and never reads the CLI's session title. The SDK ignores `title` on a
 * resume, so a resumed session keeps whatever title it already persisted.
 */
export const CLAUDE_QUERY_DEFAULTS: Pick<
  Options,
  "settingSources" | "includePartialMessages" | "permissionMode" | "title"
> = {
  settingSources: [],
  includePartialMessages: true,
  permissionMode: "default",
  title: "Houston",
};
