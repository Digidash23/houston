import { agentDelegationSchema } from "@houston/wire-types";
import type { ModuleContext } from "../../module-context";
import { field, requireString } from "../payload";
import type { DelegationModule } from "./index";
import { DelegationCommand } from "./types";

export function registerDelegationCommands(
  ctx: ModuleContext,
  module: DelegationModule,
): void {
  ctx.registerCommand(DelegationCommand.Get, (payload) =>
    module.getAgentDelegation(requireString(payload, "agentId")),
  );
  ctx.registerCommand(DelegationCommand.Set, (payload) =>
    module.setAgentDelegation(
      requireString(payload, "agentId"),
      agentDelegationSchema.parse(field(payload, "policy")),
    ),
  );
}
