/**
 * Where a context slot's editor stands. Pure and DOM-free.
 *
 * The slot is read through an agent (its files locally, the gateway in the
 * cloud, keyed by the open agent either way), so a workspace with no AI
 * Employee has nothing to read through: once the roster has landed empty
 * that is `noAgent`, said plainly, never a spinner that cannot end.
 */
export type ContextSlotState = "loading" | "noAgent" | "ready";

export function contextSlotState(input: {
  agentsLoaded: boolean;
  agentPath: string | undefined;
  hasData: boolean;
}): ContextSlotState {
  if (!input.agentPath) return input.agentsLoaded ? "noAgent" : "loading";
  return input.hasData ? "ready" : "loading";
}
