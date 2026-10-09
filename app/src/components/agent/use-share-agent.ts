import type { AgentAssignment, OrgMember } from "@houston/engine-adapter";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { tauriAgents } from "../../lib/agents-facade";
import { analytics } from "../../lib/analytics";
import { tellOptimisticRefusal } from "../../lib/optimistic-write";
import type { Agent } from "../../lib/types";
import { useAgentStore } from "../../stores/agents";
import { useWorkspaceStore } from "../../stores/workspaces";
import { accessWidened } from "./agent-access-diff.ts";

/**
 * Optimistic write for an agent's assignee roster (Teams v2). Sends the
 * explicit `{userId, access}[]` via `tauriAgents.setAssignments`, which routes
 * through `call()` (reporting, and the expected-state toasts). This hook adds
 * the OPTIMISTIC part: it patches the agent's `assignments` /
 * `assignedUserIds` in the Zustand agent store so the surface and the chat
 * "Shared agent" note update on click, rolls that patch back if the write
 * fails, and tells the user unless `call()` already did. `onSettled` reloads
 * the agent list so the server's authoritative shape wins.
 */
function patchAgent(
  agent: Agent,
  agentId: string,
  assignments: AgentAssignment[],
): Agent {
  if (agent.id !== agentId) return agent;
  return {
    ...agent,
    assignments,
    assignedUserIds: assignments.map((a) => a.userId),
  };
}

/** Where the write came from, for the `agent_shared` event. */
export type ShareSource = "share_dialog" | "agent_settings_people";

export interface ShareAgentVariables {
  agentId: string;
  /** The roster to write (set-replace). Empty = shared with everyone. */
  assignments: AgentAssignment[];
  /**
   * The org roster. Needed to tell a real widening from a no-op: the everyone
   * sentinel only expands against the member list ({@link accessWidened}).
   */
  members: readonly OrgMember[];
}

export function useShareAgent(source: ShareSource) {
  const { t } = useTranslation("teams");
  return useMutation({
    mutationFn: ({ agentId, assignments }: ShareAgentVariables) =>
      tauriAgents.setAssignments(agentId, assignments),
    onMutate: ({ agentId, assignments }) => {
      const store = useAgentStore.getState();
      const snapshot = { agents: store.agents, current: store.current };
      useAgentStore.setState({
        agents: store.agents.map((a) => patchAgent(a, agentId, assignments)),
        current: store.current
          ? patchAgent(store.current, agentId, assignments)
          : null,
      });
      return snapshot;
    },
    onSuccess: (_data, { agentId, assignments, members }, snapshot) => {
      // Only an actual WIDENING is a share; narrowing is revocation, and
      // making the everyone sentinel explicit changes nobody's access at all.
      const before = snapshot?.agents.find((a) => a.id === agentId);
      if (!before) return;
      const widened = accessWidened({
        before,
        after: {
          assignments,
          assignedUserIds: assignments.map((a) => a.userId),
        },
        members,
      });
      if (widened) {
        analytics.track("agent_shared", { agent_id: agentId, source });
      }
    },
    onError: (err, _vars, snapshot) => {
      if (snapshot) {
        useAgentStore.setState({
          agents: snapshot.agents,
          current: snapshot.current,
        });
      }
      tellOptimisticRefusal("set_agent_assignments", err, {
        title: t("writeFailed.agentAccess.title"),
        description: t("writeFailed.agentAccess.description"),
      });
    },
    onSettled: () => {
      const workspaceId = useWorkspaceStore.getState().current?.id;
      if (workspaceId) {
        void useAgentStore.getState().loadAgents(workspaceId, { silent: true });
      }
    },
  });
}

/** The mutation object surfaces pass down so one write channel serves them all. */
export type ShareAgentMutation = ReturnType<typeof useShareAgent>;
