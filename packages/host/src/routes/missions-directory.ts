import type { AgentDelegationRefusalCode } from "@houston/protocol";
import { gatewayAgentSlug } from "../assistant/coordinator-scope";
import type { Agent, Workspace } from "../domain/types";
import { assistantRuntimeRole } from "../launcher/assistant-role";
import { resolveMissionGateway } from "./agent-caller-wiring";
import type { AgentRef } from "./agent-refs";
import type { AssistantGateway } from "./assistant-forward";
import { delegationRefusal } from "./mission-delegation-refusals";
import { gatewayMissionDirectory } from "./missions-directory-gateway";
import type { MissionsCtx } from "./missions-sandbox";
import { reachableAgents } from "./reachable-agents";

/**
 * WHICH agents a mission call may be addressed to — the one place that answers
 * it, because the answer differs by deployment:
 *
 *  - DESKTOP / SELF-HOST: regular agents see their own workspace, including
 *    their own board for explicit self references. The AI Manager spans the
 *    owner's workspaces.
 *  - MANAGED CLOUD: regular agents and the AI Manager use the local candidates
 *    plus agents the gateway lists for their acting person (`GET /agents`).
 *
 * Both shapes answer the same candidate list, so target resolution
 * (missions-target.ts) never branches on the deployment.
 */

/**
 * One agent a mission may be put on. It is an {@link AgentRef} — the shape the
 * shared ladder matches a written reference against (agent-refs.ts) — plus
 * where the board actually lives: on this disk, or in that agent's own pod.
 */
export interface LocalMissionTarget extends AgentRef {
  remote: false;
  ws: Workspace;
  agent: Agent;
}

export interface RemoteMissionTarget extends AgentRef {
  remote: true;
  role?: string;
}

export type MissionTargetCandidate = LocalMissionTarget | RemoteMissionTarget;

export type MissionDirectoryResult =
  | { ok: true; candidates: MissionTargetCandidate[] }
  | {
      ok: false;
      status: number;
      code: "agents_unreadable" | AgentDelegationRefusalCode;
      error: string;
    };

export interface MissionTargetDirectory {
  /** Every agent the caller can reach, its own space first. */
  list(): Promise<MissionDirectoryResult>;
}

/** Test seam / explicit wiring for the gateway half of the directory. */
export interface MissionDirectoryOptions {
  /** Where the user's other agents live. Default: the pod's gateway wiring. */
  gateway?: AssistantGateway | null;
  fetchImpl?: typeof fetch;
  /** The caller's verified acting identity, relayed to the gateway. */
  actingAs?: string;
}

/**
 * The store supplies addressable agents. Regular agents are narrowed to their
 * own workspace; the AI Manager keeps the owner's full workspace reach.
 */
export function localMissionDirectory(
  ctx: MissionsCtx,
): MissionTargetDirectory {
  return {
    async list() {
      const reachable = await reachableAgents(ctx.deps.store, ctx.ws);
      const manager = assistantRuntimeRole({ agentId: ctx.agent.id });
      return {
        ok: true,
        candidates: reachable
          .filter(
            ({ workspace, agent }) =>
              (manager || workspace.id === ctx.ws.id) &&
              (!manager || agent.id !== ctx.agent.id),
          )
          .map(({ workspace, agent }) => ({
            remote: false as const,
            id: agent.id,
            name: agent.name,
            workspace: workspace.name,
            workspaceId: workspace.id,
            ws: workspace,
            agent,
          })),
      };
    },
  };
}

/**
 * The directory this deployment answers with: the local store, plus the
 * gateway's agents when a gateway fronts this host and hands it a
 * credential. Local candidates come first, so a
 * host that also holds the agent locally keeps serving it locally.
 */
export function missionTargetDirectory(
  ctx: MissionsCtx,
  opts: MissionDirectoryOptions = {},
): MissionTargetDirectory {
  const local = localMissionDirectory(ctx);
  const wiring = resolveMissionGateway(ctx);
  if (!wiring.ok)
    return {
      list: async () => ({ ok: false, ...delegationRefusal(wiring.code) }),
    };
  const gateway =
    opts.gateway !== undefined ? opts.gateway : (wiring.value?.gateway ?? null);
  if (!gateway) return local;
  const remote = gatewayMissionDirectory(gateway, {
    ...opts,
    actingAs: opts.actingAs ?? wiring.value?.actingAs,
    excludeIds: [ctx.agent.id, gatewayAgentSlug() ?? ctx.agent.id],
  });
  return {
    async list() {
      const [here, there] = await Promise.all([local.list(), remote.list()]);
      if (!here.ok) return here;
      if (!there.ok) return there;
      return {
        ok: true,
        candidates: [...here.candidates, ...there.candidates],
      };
    },
  };
}
