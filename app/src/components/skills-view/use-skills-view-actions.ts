import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { analytics } from "../../lib/analytics";
import { optimisticWrite } from "../../lib/optimistic-write";
import { queryKeys } from "../../lib/query-keys";
import { throwFirstRefusal } from "../../lib/settled-refusal";
import { copiesRemoved, skillWriteRefresh } from "../../lib/skill-optimistic";
import { tauriAgent, tauriSkills } from "../../lib/tauri";
import type { WorkspaceSkillRow } from "../../lib/workspace-skills";
import { useUIStore } from "../../stores/ui";

const skillMdPath = (slug: string) => `.agents/skills/${slug}/SKILL.md`;

/**
 * The copy-based skill actions (HOU-792): every operation is N
 * calls to the existing per-agent routes (skills are stored ON each agent —
 * there is no shared store, and the hosted gateway only proxies agent-scoped
 * routes). Failures surface per the no-silent-failures rule: the `call`
 * wrapper toasts write/delete failures with the real reason.
 */
export function useSkillsViewActions() {
  const { t } = useTranslation("skills");
  const qc = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const invalidateSkills = useCallback(
    (paths: string[]) => {
      for (const path of paths) {
        qc.invalidateQueries({ queryKey: queryKeys.skills(path) });
        qc.invalidateQueries({ queryKey: ["skill-detail", path] });
      }
    },
    [qc],
  );

  /** One global save: write the canonical content to `writes`, remove the copy
   *  from `deletes` (both agent folderPaths). Throws if anything failed so the
   *  dialog stays open; the failed calls have already toasted their reason. */
  const applySkillChanges = useCallback(
    async (
      row: WorkspaceSkillRow,
      args: { content: string; contentDirty: boolean },
      plan: { writes: string[]; deletes: string[] },
    ): Promise<void> => {
      const settled = await Promise.allSettled([
        ...plan.writes.map((path) =>
          tauriAgent.writeFile(path, skillMdPath(row.slug), args.content),
        ),
        ...plan.deletes.map((path) => tauriSkills.delete(path, row.slug)),
      ]);
      invalidateSkills([...plan.writes, ...plan.deletes]);
      if (args.contentDirty)
        analytics.track("skill_edited", { skill_slug: row.slug });
      if (settled.some((r) => r.status === "rejected"))
        throw new Error("skill update failed for some agents");
      addToast({ title: t("global.skillUpdated"), variant: "success" });
    },
    [addToast, invalidateSkills, t],
  );

  /**
   * Remove the skill from every agent that holds it. Optimistic: the row
   * leaves every holder's list at once and the promise resolves before the
   * host answers, so the editor can leave straight away. A refusal from ANY
   * holder puts every list back and refetches the truth, with one toast.
   */
  const deleteSkillEverywhere = useCallback(
    async (row: WorkspaceSkillRow): Promise<void> => {
      const paths = row.agents.map((a) => a.folderPath);
      void optimisticWrite({
        qc,
        command: "skill_delete",
        patches: copiesRemoved(paths, row.slug),
        write: async () => {
          const settled = await Promise.allSettled(
            paths.map((path) => tauriSkills.delete(path, row.slug)),
          );
          throwFirstRefusal(settled);
        },
        failure: {
          title: t("global.failure.removeTitle"),
          description: t("global.failure.removeBody"),
        },
        invalidate: skillWriteRefresh(paths, null),
        onSuccess: () => {
          analytics.track("skill_deleted", { skill_slug: row.slug });
          addToast({ title: t("global.skillRemoved"), variant: "success" });
        },
      });
    },
    [addToast, qc, t],
  );

  return {
    applySkillChanges,
    deleteSkillEverywhere,
  };
}
