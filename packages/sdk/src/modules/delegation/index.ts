import type { AgentDelegation } from "@houston/wire-types";
import type { ModuleContext } from "../../module-context";
import { moduleScope, SdkHttpError } from "../http";
import { registerDelegationCommands } from "./commands";
import { getAgentDelegation, setAgentDelegation } from "./http";

export {
  delegationWithAccepts,
  delegationWithAgent,
  delegationWithMode,
  otherAddressableAgents,
} from "./policy";
export { DelegationCommand, type DelegationCommandType } from "./types";

export interface DelegationModule {
  getAgentDelegation(agentId: string): Promise<AgentDelegation>;
  setAgentDelegation(
    agentId: string,
    policy: AgentDelegation,
  ): Promise<AgentDelegation>;
}

export class DelegationHttpError extends SdkHttpError {
  constructor(message: string, status: number) {
    super(message, status, "DelegationHttpError");
  }
}

export function createDelegationModule(ctx: ModuleContext): DelegationModule {
  const scope = moduleScope(ctx, "delegation", DelegationHttpError);
  const module: DelegationModule = {
    getAgentDelegation: (agentId) => getAgentDelegation(scope, agentId),
    setAgentDelegation: (agentId, policy) =>
      setAgentDelegation(scope, agentId, policy),
  };
  registerDelegationCommands(ctx, module);
  return module;
}
