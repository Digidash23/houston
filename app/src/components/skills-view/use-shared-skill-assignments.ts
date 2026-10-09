import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { OptimisticPatch } from "../../lib/optimistic-write";
import { optimisticWrite } from "../../lib/optimistic-write";
import {
  copiesRemoved,
  manifestsSet,
  skillWriteRefresh,
} from "../../lib/skill-optimistic";
import { tauriSkillsManifest } from "../../lib/tauri";
import type { Agent } from "../../lib/types";
import type { SharedSkillRow } from "../../lib/workspace-shared-skills";
import { useUIStore } from "../../stores/ui";

/** One assignment write, as `assign` below runs it. */
interface Assignment {
  command: string;
  agentPaths: string[];
  patches: OptimisticPatch[];
  /** `async`, always: the warming guard throws synchronously, and a throw
   *  before the promise exists would skip the rollback. */
  write: () => Promise<unknown>;
  failure: "add" | "update";
  /** The success toast, once the host has it. */
  notice: string;
}

/**
 * The store-skill acts that change WHO loads a workspace skill (ADR 0003):
 * manifest entries on or off, and the agent's own shadowing copy dropped
 * where the act says so. Every one is optimistic: the lists, the open editor's
 * notice and the "add existing" dialog move the instant the user acts, and
 * the promise resolves before the host answers so a caller can leave the
 * editor straight away. A refusal puts every cache back, refetches, and says
 * so once with authored copy (`optimisticWrite`).
 */
export function useSharedSkillAssignments(workspaceId: string | null) {
  const { t } = useTranslation("skills");
  const qc = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const assign = useCallback(
    (a: Assignment) => {
      void optimisticWrite({
        qc,
        command: a.command,
        patches: a.patches,
        write: a.write,
        failure: {
          title: t(`global.failure.${a.failure}Title`),
          description: t(`global.failure.${a.failure}Body`),
        },
        invalidate: skillWriteRefresh(a.agentPaths, workspaceId),
        onSuccess: () => addToast({ title: a.notice, variant: "success" }),
      });
    },
    [addToast, qc, t, workspaceId],
  );

  /** Enable a store skill for every agent: N manifest writes, all or none. */
  const enableForAll = useCallback(
    async (row: SharedSkillRow, agents: Agent[]): Promise<void> => {
      const paths = agents.map((agent) => agent.folderPath);
      assign({
        command: "skill_enable_for_all",
        agentPaths: paths,
        patches: manifestsSet(paths, row.slug, true),
        write: async () => {
          const settled = await Promise.allSettled(
            paths.map((path) =>
              tauriSkillsManifest.setEnabled(path, row.slug, true),
            ),
          );
          if (settled.some((r) => r.status === "rejected"))
            throw new Error("enable failed for some agents");
        },
        failure: "update",
        notice: t("global.enabledForAll", { count: agents.length }),
      });
    },
    [assign, t],
  );

  /** "Add an existing skill": ONE employee starts loading a store skill. */
  const addToAgent = useCallback(
    async (row: SharedSkillRow, agent: Agent, notice: string) => {
      assign({
        command: "skill_add_existing",
        agentPaths: [agent.folderPath],
        patches: manifestsSet([agent.folderPath], row.slug, true),
        write: async () =>
          tauriSkillsManifest.setEnabled(agent.folderPath, row.slug, true),
        failure: "add",
        notice,
      });
    },
    [assign],
  );

  /**
   * "Disable for this AI Employee": the manifest entry off and the agent's own
   * shadowing copy dropped. A local copy loads whether or not the manifest
   * names it, so the two only mean anything together — which is why the order
   * lives in the SDK and this is a delegate.
   */
  const disableForAgent = useCallback(
    async (row: SharedSkillRow, agent: Agent): Promise<void> => {
      const paths = [agent.folderPath];
      assign({
        command: "skill_disable_for_agent",
        agentPaths: paths,
        patches: [
          ...manifestsSet(paths, row.slug, false),
          ...copiesRemoved(paths, row.slug),
        ],
        write: async () =>
          tauriSkillsManifest.disableForAgent(agent.folderPath, row.slug),
        failure: "update",
        notice: t("global.disabledForAgent", { name: agent.name }),
      });
    },
    [assign, t],
  );

  /** Back on the store version: the manifest entry switched on, then the
   *  agent's overriding copy dropped. Deleting the copy first would leave the
   *  agent with neither version, which is why the order is the SDK's. */
  const revertOverride = useCallback(
    async (row: SharedSkillRow, agent: Agent): Promise<void> => {
      const paths = [agent.folderPath];
      assign({
        command: "skill_revert_override",
        agentPaths: paths,
        patches: [
          ...manifestsSet(paths, row.slug, true),
          ...copiesRemoved(paths, row.slug),
        ],
        write: async () =>
          tauriSkillsManifest.revertOverride(agent.folderPath, row.slug),
        failure: "update",
        notice: t("global.overrideReverted", { name: agent.name }),
      });
    },
    [assign, t],
  );

  return { enableForAll, addToAgent, disableForAgent, revertOverride };
}
