/**
 * The agent's display name as the gateway's registry holds it. In a cloud
 * org the folder (and so the engine id) never changes after creation; a
 * rename writes only the registry name, which the gateway stamps on every
 * request it proxies to a managed pod and on every pool op envelope
 * (`agentName`). Trusted only where the gateway fronts every request
 * (gatewayFronted, the same stance as the acting-as header): on the desktop
 * and self-host it is client input and never read.
 */

import { validateAgentName } from "@houston/domain";
import type { Agent } from "../domain/types";

/** Percent-encoded UTF-8, lowercase for Node's IncomingMessage.headers. */
export const AGENT_NAME_HEADER = "x-houston-agent-name";

/** A usable display name, or undefined: a missing or invalid name is never
 *  an error, the folder's name simply stays. */
export function validDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const checked = validateAgentName(value);
  return checked.ok ? checked.name : undefined;
}

/** The header's display name, decoded; undefined for anything unusable. */
export function displayNameFromHeader(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  try {
    return validDisplayName(decodeURIComponent(raw));
  } catch {
    return undefined; // malformed percent-encoding
  }
}

/** The agent under its display name. The id stays the folder's: paths,
 *  events and store keys all address the agent by id. */
export function withDisplayName(agent: Agent, name: string | undefined): Agent {
  return name ? { ...agent, name } : agent;
}
