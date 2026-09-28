import type { AgentDelegation } from "@houston/protocol";
import { getEngine } from "./engine";
import { engineCall } from "./tauri";

export const tauriAgentDelegation = {
  get: (agentId: string) =>
    engineCall<AgentDelegation>(
      "get_agent_delegation",
      () => getEngine().getAgentDelegation(agentId),
      undefined,
      { toast: false, capture: false },
    ),
  set: (agentId: string, policy: AgentDelegation) =>
    engineCall<AgentDelegation>(
      "set_agent_delegation",
      () => getEngine().setAgentDelegation(agentId, policy),
      undefined,
      { toast: false, capture: false },
    ),
};
