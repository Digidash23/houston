import type { AgentDelegation } from "@houston/wire-types";
import { type HttpScope, httpRequest } from "../http";

/**
 * Reads which AI Employees an agent may work with and whether it takes missions.
 * @param agentId The agent this acts on, by the id listAgents returns.
 * @assistant group:agents
 */
export async function getAgentDelegation(
  scope: HttpScope,
  agentId: string,
): Promise<AgentDelegation> {
  const res = await httpRequest(
    scope,
    `/v1/agents/${encodeURIComponent(agentId)}/delegation`,
  );
  return (await res.json()) as AgentDelegation;
}

/**
 * Sets which AI Employees an agent may work with and whether it takes missions.
 * @param agentId The agent this acts on, by the id listAgents returns.
 * @param policy The full policy to save, including outgoing mode and incoming switch.
 * @assistant group:agents
 * @assistant confirm: It decides which AI Employees this one may hand work to, and whether others may start new missions for it.
 */
export async function setAgentDelegation(
  scope: HttpScope,
  agentId: string,
  policy: AgentDelegation,
): Promise<AgentDelegation> {
  const res = await httpRequest(
    scope,
    `/v1/agents/${encodeURIComponent(agentId)}/delegation`,
    { method: "PUT", body: JSON.stringify(policy) },
  );
  return (await res.json()) as AgentDelegation;
}
