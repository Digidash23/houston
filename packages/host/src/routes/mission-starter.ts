import type { IncomingMessage } from "node:http";
import type { MissionStarter } from "@houston/protocol";
import { isAssistantRequest } from "../auth/assistant-call";
import { assistantRuntimeRole } from "../launcher/assistant-role";

/**
 * WHICH AI started a mission (PRODUCT-1928), decided from what the host
 * verified about the caller, never from anything the caller wrote.
 */

/** A start from an agent's own turn: the coordinator is Houston, anyone else
 *  an AI Employee. Judged on the CALLER, before the start is retargeted. */
export function callerMissionStarter(agentId: string): MissionStarter {
  return assistantRuntimeRole({ agentId }) ? "houston" : "employee";
}

/**
 * A start or card create arriving over HTTP. The calling-agent header is the
 * gateway-verified C21 marker (`trustedCallingAgent`), so it outranks the
 * manager check. Undefined is a person calling the route directly, which is
 * recorded as no starter at all.
 */
export function inboundMissionStarter(
  deps: { gatewayFronted?: boolean },
  req: IncomingMessage,
  callingAgent?: string,
): MissionStarter | undefined {
  if (callingAgent) return "employee";
  return isAssistantRequest(deps, req) ? "houston" : undefined;
}
