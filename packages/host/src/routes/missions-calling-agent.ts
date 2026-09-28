import type { IncomingMessage } from "node:http";
import type { MissionsDeps } from "./missions-sandbox";

export const CALLING_AGENT_HEADER = "x-houston-calling-agent";
export const MISSION_ID_HEADER = "x-houston-mission-id";

export function trustedCallingAgent(
  deps: MissionsDeps,
  req: IncomingMessage,
): string | undefined {
  if (!deps.gatewayFronted) return undefined;
  const raw = req.headers[CALLING_AGENT_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}
