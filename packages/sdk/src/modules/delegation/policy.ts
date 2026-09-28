import type { AgentDelegation, AgentDelegationMode } from "@houston/wire-types";

export function delegationWithMode(
  policy: AgentDelegation,
  mode: AgentDelegationMode,
): AgentDelegation {
  return {
    ...policy,
    mode,
    agents: mode === "picked" ? [...policy.agents] : [],
  };
}

export function delegationWithAgent(
  policy: AgentDelegation,
  id: string,
  allowed: boolean,
): AgentDelegation {
  return {
    ...policy,
    mode: "picked",
    agents: allowed
      ? [...new Set([...policy.agents, id])]
      : policy.agents.filter((agent) => agent !== id),
  };
}

export function delegationWithAccepts(
  policy: AgentDelegation,
  acceptsMissions: boolean,
): AgentDelegation {
  return { ...policy, acceptsMissions };
}

export function otherAddressableAgents<Agent extends { id: string }>(
  roster: readonly Agent[],
  selfId: string,
): Agent[] {
  return roster.filter(
    (agent) =>
      agent.id !== selfId && !agent.id.split("/").at(-1)?.startsWith("."),
  );
}
