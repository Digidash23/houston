/**
 * The key a question card's in-flight send is held under across remounts.
 * Conversation keys are only unique within one agent, so two agents asking
 * the same question in same-named conversations must not share a key: the
 * second card would sit disabled and drop its own mount-time completion.
 */
export function interactionCompletionKey(
  agentId: string,
  sessionKey: string | null | undefined,
  identity: string,
): string {
  return JSON.stringify([agentId, sessionKey ?? "", identity]);
}
