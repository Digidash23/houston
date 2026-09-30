import { openAgentBoard } from "../lib/open-agent";
import type { Agent } from "../lib/types";
import { useUIStore } from "../stores/ui";

export function resolveStartedMissionAgent(
  agentKey: string,
  agents: readonly Agent[],
): Agent | undefined {
  return agents.find(
    (agent) => agent.id === agentKey || agent.name === agentKey,
  );
}

export function openStartedMission(agent: Agent, missionId: string): void {
  openAgentBoard(agent.id, {
    onOpened: () =>
      useUIStore.getState().setActivityPanelId(missionId, { forceOpen: true }),
  });
}
