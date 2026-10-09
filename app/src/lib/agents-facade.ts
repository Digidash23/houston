/**
 * Agent CRUD as the app reaches it: list, create, rename, recolor, delete,
 * first-day start and the sharing roster, each wrapped in the same
 * error-surfacing policy every other engine call gets.
 *
 * Part of `./tauri` rather than a layer of its own. It sits in its own file only
 * because that module is the app's whole engine-facing surface and has no business
 * growing a namespace per feature; it reaches the engine through `getEngine()`
 * and its failures through `engineCall`, exactly as the namespaces still living
 * there do (`scripts/check-boundaries.mjs` rule D names this file for that
 * reason).
 */

import type {
  AgentAssignment,
  AgentInitialConfig,
  FirstDayStartInput,
  FirstDayStartResult,
} from "@houston/engine-adapter";
import {
  isAgentNameReserved,
  isAgentNameTaken,
  isFirstDayNotPending,
} from "@houston/sdk";
import { blockWriteWhileWarmingById } from "./agent-warming-guard";
import { getEngine } from "./engine";
import { engineCall } from "./tauri";
import type { Agent } from "./types";

export interface CreateAgentResult {
  agent: Agent;
}

/** Engine wire agent → app Agent. Exported for flows that receive an agent
 *  record outside the tauriAgents wrappers (the import wizard, HOU-710). */
export function toAgent(a: import("@houston/engine-adapter").Agent): Agent {
  return {
    id: a.id,
    name: a.name,
    folderPath: a.folderPath,
    localDir: a.localDir,
    configId: a.configId,
    color: a.color,
    createdAt: a.createdAt,
    lastOpenedAt: a.lastOpenedAt,
    assigned: a.assigned,
    assignedUserIds: a.assignedUserIds,
    access: a.access,
    assignments: a.assignments,
  };
}

export const tauriAgents = {
  list: (workspaceId: string) =>
    engineCall<Agent[]>("list_agents", async () =>
      (await getEngine().listAgents(workspaceId)).map(toAgent),
    ),
  create: (
    workspaceId: string,
    name: string,
    configId: string,
    color?: string,
    claudeMd?: string,
    installedPath?: string,
    seeds?: Record<string, string>,
    existingPath?: string,
    config?: AgentInitialConfig,
  ) =>
    engineCall<CreateAgentResult>(
      "create_agent",
      async () => {
        const r = await getEngine().createAgent(workspaceId, {
          name,
          configId,
          color,
          claudeMd,
          installedPath,
          seeds,
          existingPath,
          config,
        });
        return {
          agent: toAgent(r.agent),
        };
      },
      undefined,
      // A 409 (name already taken) renders as friendly inline copy in the
      // create dialog — the generic red bug toast would double-surface it.
      { silence: isAgentNameTaken },
    ),
  delete: (workspaceId: string, id: string) =>
    engineCall<void>("delete_agent", () =>
      getEngine().deleteAgent(workspaceId, id),
    ),
  // No warming-write guard, unlike the agent's other writes: a new hire offers
  // its first day while its engine still warms, and the SDK's start rides that
  // out (the host makes a repeated start hand back the same task).
  startFirstDay: (agentPath: string, input: FirstDayStartInput) =>
    engineCall<FirstDayStartResult>(
      "start_first_day",
      () => getEngine().startFirstDay(agentPath, input),
      { agentId: agentPath },
      { silence: isFirstDayNotPending },
    ),
  rename: (workspaceId: string, id: string, newName: string) => {
    // A rename dispatches into the agent's engine — held while it warms up.
    blockWriteWhileWarmingById(id);
    return engineCall<Agent>(
      "rename_agent",
      async () =>
        toAgent(await getEngine().renameAgent(workspaceId, id, newName)),
      undefined,
      // Both refusals render as authored copy in `useAgentActions`.
      {
        silence: (err: unknown) =>
          isAgentNameTaken(err) || isAgentNameReserved(err),
      },
    );
  },
  updateColor: (workspaceId: string, id: string, color: string) =>
    engineCall<Agent>("update_agent_color", async () =>
      toAgent(await getEngine().updateAgent(workspaceId, id, { color })),
    ),
  /** Agent configs installed on disk (bundled + user-authored), merged with the
   *  built-in templates by the agent loader to populate the create-agent gallery. */
  listInstalledConfigs: () =>
    engineCall<Array<{ config: unknown; path: string }>>(
      "list_installed_configs",
      () => getEngine().listInstalledConfigs(),
    ),
  /** Multiplayer: set which org members may use this agent, and at what access
   *  level. Pass the `AgentAssignment[]` (`{userId, access}`) roster from the
   *  Share dialog — every row states its own access, so nothing can demote a
   *  manager by omission. Empty = everyone. */
  setAssignments: (agentSlugOrId: string, assignments: AgentAssignment[]) =>
    engineCall<void>("set_agent_assignments", () =>
      getEngine().setAgentAssignments(agentSlugOrId, assignments),
    ),
};
