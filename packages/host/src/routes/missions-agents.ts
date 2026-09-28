import type { ServerResponse } from "node:http";
import type { AgentDirectoryEntry, AgentProfile } from "@houston/protocol";
import { readAgentRole } from "../agent-role/read-role";
import { assistantRuntimeRole } from "../launcher/assistant-role";
import { readAgentDelegation } from "./agent-delegation-store";
import { json } from "./http";
import { delegationRefusal } from "./mission-delegation-refusals";
import { missionTargetDirectory } from "./missions-directory";
import { readRemoteInstructions } from "./missions-remote-agentfile";
import type { MissionsCtx } from "./missions-sandbox";
import { refuseMissionRoute, resolveMissionRoute } from "./missions-target";

const MAX_INSTRUCTIONS = 12_000;

export async function handleAgentDirectory(
  ctx: MissionsCtx,
  res: ServerResponse,
): Promise<void> {
  const manager = assistantRuntimeRole({ agentId: ctx.agent.id });
  const policy = manager
    ? null
    : await readAgentDelegation(ctx.vfs, ctx.ws.id, ctx.agent.id);
  if (policy?.mode === "off") {
    const refusal = delegationRefusal("delegation_off");
    json(res, refusal.status, { code: refusal.code, error: refusal.error });
    return;
  }
  const directory = await missionTargetDirectory(ctx).list();
  if (!directory.ok) {
    json(res, directory.status, {
      code: directory.code,
      error: directory.error,
    });
    return;
  }
  const candidates = directory.candidates.filter(
    (target) =>
      target.id !== ctx.agent.id &&
      !target.name.startsWith(".") &&
      !target.id.startsWith(".") &&
      (manager ||
        policy?.mode !== "picked" ||
        policy.agents.includes(target.id)),
  );
  const agents: AgentDirectoryEntry[] = await Promise.all(
    candidates.map(async (target) => {
      const role = target.remote
        ? target.role
        : await readAgentRole(
            ctx.vfs,
            ctx.paths.agentRoot(target.ws, target.agent),
          );
      return {
        id: target.id,
        name: target.name,
        ...(role ? { role } : {}),
        ...(target.workspace ? { space: target.workspace } : {}),
      };
    }),
  );
  json(res, 200, { agents });
}

export async function handleAgentProfile(
  ctx: MissionsCtx,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const route = await resolveMissionRoute(
    ctx,
    url.searchParams.get("agent") ?? undefined,
    {},
    "read",
  );
  if (!route.ok) return refuseMissionRoute(route, res);
  if (route.remote) {
    const result = await readRemoteInstructions(route.route);
    if (result.ok) json(res, 200, result.profile);
    else json(res, result.status, { code: result.code, error: result.error });
    return;
  }
  const target = route.ctx;
  const instructions =
    (await target.vfs.readText(`${target.root}/CLAUDE.md`)) ?? "";
  const role = await readAgentRole(target.vfs, target.root);
  const profile: AgentProfile = {
    id: target.agent.id,
    name: target.agent.name,
    ...(role ? { role } : {}),
    instructions: instructions.slice(0, MAX_INSTRUCTIONS),
    truncated: instructions.length > MAX_INSTRUCTIONS,
  };
  json(res, 200, profile);
}
