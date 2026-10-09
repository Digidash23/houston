import { useState } from "react";
import { logAndReportError } from "../../lib/error-report";
import type { Agent } from "../../lib/types";
import type { SharedSkillRow } from "../../lib/workspace-shared-skills";
import type {
  ManagedSkillRow,
  SharedDialogActions,
  SkillEditorActions,
} from "./skill-editor-props";

/**
 * The skill editor's save + delete flow, split out for the file law, for ONE
 * employee's Skills section. A store skill's save is one store write; a copy's
 * save rewrites this employee's copy and no one else's. Delete removes this
 * employee's copy, behind a confirm; deleting a skill for EVERY employee is the
 * menu's own act (`use-workspace-skill-acts.tsx`). A save failure is already
 * surfaced by the `call` wrapper, and the editor stays open with the typed
 * work so the user can retry. Delete is optimistic: the skill leaves the list
 * and the editor at once, and a refusal puts it back with its own toast; the
 * catch below only meets a throw before the write starts, and reports it.
 *
 * `onSaved` and `onDeleted` are separate because the editor stays on the skill
 * it just saved and only leaves once the skill is gone.
 */
export function useSkillSave(args: {
  row: ManagedSkillRow | null;
  /** The employee whose Skills section this is. */
  agent: Agent;
  isShared: boolean;
  shared: SharedDialogActions | undefined;
  onApply: SkillEditorActions["onApply"];
  onDeleteEverywhere: SkillEditorActions["onDeleteEverywhere"];
  /** A save landed. */
  onSaved: () => void;
  /** The skill no longer exists on this employee. */
  onDeleted: () => void;
}) {
  const { row, agent, isShared, shared, onApply, onDeleteEverywhere } = args;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async (draft: { content: string; contentDirty: boolean }) => {
    if (!row) return;
    const saveArgs = {
      content: draft.content,
      contentDirty: draft.contentDirty,
    };
    if (isShared && shared) {
      await shared.onApply(row as SharedSkillRow, saveArgs, {
        enable: [],
        disable: [],
      });
    } else {
      await onApply(row, saveArgs, {
        writes: draft.contentDirty ? [agent.folderPath] : [],
        deletes: [],
      });
    }
    args.onSaved();
  };

  return {
    save,
    confirmDelete,
    openConfirmDelete: () => setConfirmDelete(true),
    cancelConfirmDelete: () => setConfirmDelete(false),
    confirmDeleteNow: () => {
      setConfirmDelete(false);
      if (!row) return;
      // Only THIS employee's copy: the row may name other holders of the same
      // slug, whose copies are theirs.
      const mine = {
        ...row,
        agents: row.agents.filter((holder) => holder.id === agent.id),
      };
      void onDeleteEverywhere(mine)
        .then(args.onDeleted)
        .catch((err: unknown) => logAndReportError("skill_delete", err));
    },
  };
}
