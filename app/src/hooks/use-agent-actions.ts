import { isAgentNameReserved, isAgentNameTaken } from "@houston/sdk";
import type { TFunction } from "i18next";
import { useEmployeeNameIssueCopy } from "../components/employee-card/use-employee-name";
import { agentNameIssue } from "../lib/agent-name";
import { isAgentWarmingRefusal } from "../lib/agent-warming-refusal";
import { showExpectedStateToast } from "../lib/error-toast";
import { tellOptimisticRefusal } from "../lib/optimistic-write";
import { renameAgentWithFollowUp } from "../lib/rename-agent-follow-up";
import { useAgentStore } from "../stores/agents";

/** Only `agents:` keys are read here, so that is the whole namespace list. */
type AgentActionsT = TFunction<["agents"]>;

/**
 * An agent's mutations: rename (validated before the PATCH), colour, delete.
 * All three are optimistic in the store; a refusal is told here, once, with
 * authored copy (the expected name refusals keep their own).
 *
 * These were the RAIL's, in `shell/use-sidebar-agent-actions.ts`, behind the
 * agent row's "..." menu. That menu is gone — an agent row in the rail is a
 * destination now, not a thing you administer from the sidebar — so the same
 * three handlers moved here, to `hooks/`, and are driven from the one surface
 * that is ABOUT administering agents: a team's focused agent screen.
 *
 * Lifted rather than rewritten on purpose. The rename rules in particular
 * (validate before the PATCH, catch the 409 race, name the conflict in the
 * user's words) are hard-won and must not exist twice.
 */
export function useAgentActions(args: {
  t: AgentActionsT;
  workspaceId: string | undefined;
  /** Every agent in the workspace — the duplicate-name check reads it. */
  agentNamesById: Array<{ id: string; name: string }>;
  /** Repoints the stored layout at an agent's new id after a rename. */
  remapAgentId: (previousId: string, nextId: string) => void;
}) {
  const { t, workspaceId, agentNamesById, remapAgentId } = args;
  const renameAgent = useAgentStore((s) => s.rename);
  const deleteAgent = useAgentStore((s) => s.delete);
  const updateAgentColor = useAgentStore((s) => s.updateColor);
  const issueCopy = useEmployeeNameIssueCopy();
  const nameOf = (agentId: string) =>
    agentNamesById.find((a) => a.id === agentId)?.name ?? "";
  // The store already put the row back; this says what did not happen, then
  // rethrows so a caller tracking its own save state still sees the refusal.
  const refused = (
    command: string,
    titleKey:
      | "agents:toasts.renameFailed"
      | "agents:toasts.colorFailed"
      | "agents:toasts.deleteFailed",
    agentId: string,
    err: unknown,
  ): never => {
    // The warming guard's own dialog is already open and says it all.
    if (!isAgentWarmingRefusal(err)) {
      tellOptimisticRefusal(command, err, {
        title: t(titleKey, { name: nameOf(agentId) }),
        description: t("agents:toasts.writeFailedDescription"),
      });
    }
    throw err;
  };

  const rename = async (agentId: string, newName: string) => {
    if (!workspaceId) return;
    // Validate BEFORE the PATCH (HOU-1166): bad shapes and known duplicates
    // get the expected-state toast without a round-trip. The 409 catch below
    // stays for races (a sibling took the name after this list loaded).
    // The agent's own current name is passed so one already called Houston
    // keeps it (the AI Manager's name is only refused as a NEW name).
    const issue = agentNameIssue(
      newName,
      agentNamesById.filter((a) => a.id !== agentId).map((a) => a.name),
      agentNamesById.find((a) => a.id === agentId)?.name,
    );
    if (issue) {
      showExpectedStateToast(
        issueCopy(issue, newName),
        t("agents:toasts.nameConflictDescription"),
      );
      return;
    }
    try {
      // Hand the caller the renamed agent: the id is folder-derived, so a
      // follow-up write (the identity dialog's colour half) must target the
      // NEW id, not the one that just stopped existing.
      return await renameAgentWithFollowUp({
        workspaceId,
        agentId,
        name: newName,
        renameAgent,
        remapAgentId,
      });
    } catch (err) {
      if (isAgentNameTaken(err)) {
        showExpectedStateToast(
          t("agents:toasts.nameConflict", { name: newName }),
          t("agents:toasts.nameConflictDescription"),
        );
        return;
      }
      // The loaded list still showed this agent under "Houston" after it was
      // renamed elsewhere, so the pre-check let the name through.
      if (isAgentNameReserved(err)) {
        showExpectedStateToast(
          t("agents:nameErrors.reserved"),
          t("agents:toasts.nameConflictDescription"),
        );
        return;
      }
      return refused(
        "rename_agent",
        "agents:toasts.renameFailed",
        agentId,
        err,
      );
    }
  };

  const changeColor = async (agentId: string, color: string) => {
    if (!workspaceId) return;
    try {
      await updateAgentColor(workspaceId, agentId, color);
    } catch (err) {
      refused("update_agent_color", "agents:toasts.colorFailed", agentId, err);
    }
  };

  const remove = async (agentId: string) => {
    if (!workspaceId) return;
    try {
      await deleteAgent(workspaceId, agentId);
    } catch (err) {
      refused("delete_agent", "agents:toasts.deleteFailed", agentId, err);
    }
  };

  return { rename, changeColor, remove };
}
