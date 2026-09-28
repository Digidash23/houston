import type { AgentDelegation } from "@houston/wire-types";
import type { BaseCtor } from "./mixin";
import { viaSdk } from "./sdk-error";

export function DelegationMixin<TBase extends BaseCtor>(Base: TBase) {
  class Delegation extends Base {
    async getAgentDelegation(agentId: string): Promise<AgentDelegation> {
      return viaSdk(
        `/v1/agents/${encodeURIComponent(agentId)}/delegation`,
        () => this.ctx.sdk.delegation.getAgentDelegation(agentId),
      );
    }

    async setAgentDelegation(
      agentId: string,
      policy: AgentDelegation,
    ): Promise<AgentDelegation> {
      return viaSdk(
        `/v1/agents/${encodeURIComponent(agentId)}/delegation`,
        () => this.ctx.sdk.delegation.setAgentDelegation(agentId, policy),
      );
    }
  }
  return Delegation;
}
