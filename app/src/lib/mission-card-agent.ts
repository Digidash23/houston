import type { Agent } from "./types";

export function missionOriginAgentName(
  agents: readonly Agent[],
  originAgent: string | undefined,
): string | undefined {
  if (!originAgent) return undefined;
  return agents.find(
    (agent) => agent.id === originAgent || agent.folderPath === originAgent,
  )?.name;
}
