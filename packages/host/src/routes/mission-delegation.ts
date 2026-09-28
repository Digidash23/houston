import { assistantRuntimeRole } from "../launcher/assistant-role";
import { readAgentDelegation } from "./agent-delegation-store";
import { delegationRefusal } from "./mission-delegation-refusals";
import type { LocalMissionTarget } from "./missions-directory";
import type { MissionsCtx } from "./missions-sandbox";
import type { MissionRoute } from "./missions-target";

export type MissionRouteOp = "read" | "start" | "status";

export async function localDelegationRefusal(
  ctx: MissionsCtx,
  target: LocalMissionTarget,
  op: MissionRouteOp,
): Promise<Extract<MissionRoute, { ok: false }> | null> {
  if (
    assistantRuntimeRole({ agentId: ctx.agent.id }) ||
    target.agent.id === ctx.agent.id
  )
    return null;
  const caller = await readAgentDelegation(ctx.vfs, ctx.ws.id, ctx.agent.id);
  if (caller.mode === "off")
    return { ok: false, ...delegationRefusal("delegation_off") };
  if (caller.mode === "picked" && !caller.agents.includes(target.agent.id))
    return {
      ok: false,
      ...delegationRefusal("agent_not_allowed", target.name),
    };
  if (op === "start") {
    const receiving = await readAgentDelegation(
      ctx.vfs,
      target.ws.id,
      target.agent.id,
    );
    if (!receiving.acceptsMissions)
      return {
        ok: false,
        ...delegationRefusal("agent_not_accepting", target.name),
      };
  }
  return null;
}
