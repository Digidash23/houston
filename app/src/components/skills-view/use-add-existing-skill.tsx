import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { skillDisplayTitle } from "../../lib/humanize-skill-name";
import type { Agent } from "../../lib/types";
import type { SharedSkillRow } from "../../lib/workspace-shared-skills";
import { AddExistingSkillDialog } from "./add-existing-skill-dialog";
import { addableSkills, offersAddExisting } from "./addable-skills";
import type {
  ManagedSkillRow,
  SharedDialogActions,
} from "./skill-editor-props";

/**
 * "Add an existing skill" on an AI Employee's own Skills section: the
 * workspace store skills it does not load yet, and the manifest write that
 * gives it one.
 *
 * The write is one manifest entry switched on, painted before the host
 * answers: the row leaves the dialog at once, and a refusal puts it back with
 * its own toast (`SharedDialogActions.onAddToAgent`). The employee starts
 * loading the workspace version as it stands; nothing is written to it.
 */
export function useAddExistingSkill(opts: {
  /** The employee whose Skills section this is. */
  agent: Agent;
  /** Every row this surface's scope reads, BEFORE it is narrowed to the
   *  employee — a skill it does not have yet is exactly what is offered. */
  rows: ManagedSkillRow[];
  /** Store handlers, present exactly when the deployment shares. */
  shared: SharedDialogActions | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}): {
  node: ReactNode;
  /** Open the dialog; undefined where there is no workspace store the add
   *  could write against. */
  start: (() => void) | undefined;
} {
  const { agent, rows, shared, loading, failed, onRetry } = opts;
  const { t } = useTranslation("skills");
  const [open, setOpen] = useState(false);

  const skills = useMemo(() => addableSkills(rows, agent.id), [rows, agent]);

  const onAdd = useCallback(
    async (row: ManagedSkillRow) => {
      // Unreachable: without a store there is nothing to offer, so the list
      // is empty and no row exists to press.
      if (shared === undefined) return;
      await shared.onAddToAgent(
        // Narrowed by `addableSkills`, which keeps store rows only.
        row as SharedSkillRow,
        agent,
        t("global.addExisting.added", {
          name: skillDisplayTitle(row.summary),
        }),
      );
    },
    [agent, shared, t],
  );

  return {
    node: (
      <AddExistingSkillDialog
        open={open}
        onOpenChange={setOpen}
        skills={skills}
        loading={loading}
        failed={failed}
        onRetry={onRetry}
        onAdd={onAdd}
      />
    ),
    start: offersAddExisting({ sharedStore: shared !== undefined })
      ? () => setOpen(true)
      : undefined,
  };
}
