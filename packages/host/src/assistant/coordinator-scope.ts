import { AsyncLocalStorage } from "node:async_hooks";
import type { AssistantGateway } from "../routes/assistant-forward";

/**
 * WHO the coordinator is when no pod environment says so.
 *
 * A managed assistant pod learns it is Houston from its own environment: the
 * gateway stamps the owner (HOUSTON_ASSISTANT_USER_ID), the agent's slug
 * (HOUSTON_AGENT_SLUG) and the operation credential pair into that pod alone.
 * A pool worker has none of it, and it serves Houston's turn and an ordinary
 * agent's from the same process, so the identity cannot be process-wide.
 * Instead the worker runs the host's own operation and mission handlers for
 * Houston's turn inside this scope, carrying the turn's owner, slug and
 * per-turn credential to exactly those calls.
 *
 * Every reader prefers the scope and falls back to the environment, so a
 * standing pod behaves exactly as before.
 */
export interface CoordinatorScope {
  /** The person this Houston belongs to; the gateway bound the credential to them. */
  userId: string;
  /** The assistant's gateway slug (what HOUSTON_AGENT_SLUG is on its pod). */
  agentSlug: string;
  /** Where operations are performed, with this turn's credential. */
  gateway: AssistantGateway;
}

const scope = new AsyncLocalStorage<CoordinatorScope>();

/** Run `fn` (and everything it awaits) as the coordinator `value` describes. */
export function runAsCoordinator<T>(value: CoordinatorScope, fn: () => T): T {
  return scope.run(value, fn);
}

/** The coordinator the current call runs as, or undefined outside one. */
export function coordinatorScope(): CoordinatorScope | undefined {
  return scope.getStore();
}

/** The assistant's own gateway slug: the scope's, else this pod's env. */
export function gatewayAgentSlug(): string | undefined {
  return coordinatorScope()?.agentSlug ?? process.env.HOUSTON_AGENT_SLUG;
}
