import { ConfirmDialog } from "@houston-ai/core";
import { useTranslation } from "react-i18next";
import { skillDisplayTitle } from "../../lib/humanize-skill-name";
import type { Agent } from "../../lib/types";
import type { WorkspaceSkillRow } from "../../lib/workspace-skills";
import type { ScopedActKind } from "./scoped-skill-actions";
import type { WorkspaceDeleteRequest } from "./workspace-skill-menu-items";

/**
 * The editor's handshakes, split out for the 200-line rule: leaving unsaved
 * work, and the destructive acts.
 * Delete removes THIS employee's copy, so its confirm names this employee
 * alone; Delete for all names every holder, or the workspace for a store
 * skill.
 *
 * The third handshake belongs to an employee that keeps its OWN version of a
 * workspace skill: both scoped acts delete that version, and neither reads as
 * a delete from the control that starts it.
 */
export function SkillEditorConfirms({
  row,
  agent,
  pendingLeave,
  onCancelLeave,
  onConfirmLeave,
  deleteForEveryone,
  onCancelDeleteForEveryone,
  onConfirmDeleteForEveryone,
  confirmDelete,
  onConfirmDelete,
  onCancelDelete,
  scopedAct,
  onConfirmScopedAct,
  onCancelScopedAct,
}: {
  row: WorkspaceSkillRow;
  /** The employee whose copy Delete removes. */
  agent: Agent;
  /** Leaving a dirty editor awaits the discard handshake. */
  pendingLeave: boolean;
  onCancelLeave: () => void;
  onConfirmLeave: () => void;
  /** A delete for every employee awaiting its handshake, or null. */
  deleteForEveryone: WorkspaceDeleteRequest | null;
  onCancelDeleteForEveryone: () => void;
  onConfirmDeleteForEveryone: () => void;
  confirmDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  /** The scoped act awaiting its handshake, or null while none is. */
  scopedAct: ScopedActKind | null;
  onConfirmScopedAct: () => Promise<void>;
  onCancelScopedAct: () => void;
}) {
  const { t } = useTranslation(["skills", "common"]);
  const scopedCopy =
    scopedAct === "revert"
      ? {
          title: t("skills:global.scopedOverride.revertConfirmTitle"),
          description: t("skills:global.scopedOverride.revertConfirmBody"),
          confirm: t("skills:global.manage.revert"),
        }
      : {
          title: t("skills:global.scopedOverride.disableConfirmTitle"),
          description: t("skills:global.scopedOverride.disableConfirmBody"),
          confirm: t("skills:global.manage.disableForAgent"),
        };
  const everyoneDescription =
    deleteForEveryone && deleteForEveryone.holders.length > 0
      ? t("skills:global.manage.deleteConfirmDescription", {
          count: deleteForEveryone.holders.length,
          names: deleteForEveryone.holders.join(", "),
        })
      : t("skills:global.manage.deleteSharedDescription");
  return (
    <>
      <ConfirmDialog
        open={pendingLeave}
        onOpenChange={(open) => !open && onCancelLeave()}
        title={t("skills:editor.discardConfirmTitle")}
        description={t("skills:editor.discardConfirmBody")}
        confirmLabel={t("skills:editor.discardConfirmConfirm")}
        cancelLabel={t("common:actions.cancel")}
        onConfirm={onConfirmLeave}
      />
      <ConfirmDialog
        open={deleteForEveryone !== null}
        onOpenChange={(open) => !open && onCancelDeleteForEveryone()}
        title={t("skills:global.manage.deleteConfirmTitle", {
          name: skillDisplayTitle(row.summary),
        })}
        description={everyoneDescription}
        confirmLabel={t("common:actions.delete")}
        cancelLabel={t("common:actions.cancel")}
        onConfirm={onConfirmDeleteForEveryone}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(open) => !open && onCancelDelete()}
        title={t("skills:global.manage.deleteConfirmTitle", {
          name: skillDisplayTitle(row.summary),
        })}
        description={t("skills:global.manage.deleteConfirmDescription", {
          count: 1,
          names: agent.name,
        })}
        confirmLabel={t("common:actions.delete")}
        cancelLabel={t("common:actions.cancel")}
        onConfirm={onConfirmDelete}
      />
      <ConfirmDialog
        open={scopedAct !== null}
        onOpenChange={(open) => !open && onCancelScopedAct()}
        title={scopedCopy.title}
        description={scopedCopy.description}
        confirmLabel={scopedCopy.confirm}
        cancelLabel={t("common:actions.cancel")}
        onConfirm={onConfirmScopedAct}
      />
    </>
  );
}
