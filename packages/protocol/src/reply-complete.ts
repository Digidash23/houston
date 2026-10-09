/**
 * The offer tools: a turn that calls one after its closing message is over
 * bar the offers (the runtime ends the turn on their result). The runtime
 * emits `reply_complete` when one starts, and the client does not read one
 * running after that frame as the turn carrying on.
 */
export const OFFER_TOOL_NAMES = [
  "suggest_actions",
  "suggest_reusable",
] as const;

export type OfferToolName = (typeof OFFER_TOOL_NAMES)[number];

/**
 * Whether `name` is an offer tool. Backends name Houston's tools differently
 * (the Claude Agent SDK prefixes MCP tools `mcp__<server>__`), so the prefix
 * is dropped before matching.
 */
export function isOfferToolName(name: string): boolean {
  const bare = name.replace(/^mcp__.+?__/, "");
  return (OFFER_TOOL_NAMES as readonly string[]).includes(bare);
}
