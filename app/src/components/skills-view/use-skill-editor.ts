import { useRef, useState } from "react";
import { withSkillTitle } from "../../lib/skill-title";
import type { Agent } from "../../lib/types";
import {
  reconcileSkillDraft,
  type SkillDraft,
  seedSkillDraft,
  skillDraftDirty,
} from "./skill-editor-model";
import type {
  ManagedSkillRow,
  SharedDialogActions,
  SkillEditorActions,
} from "./skill-editor-props";
import { useSkillDetailSurface } from "./use-skill-detail-surface";
import { useSkillSave } from "./use-skill-save";

export interface SkillEditorArgs extends SkillEditorActions {
  row: ManagedSkillRow;
  /** The employee whose Skills section this editor stands in. */
  agent: Agent;
  shared?: SharedDialogActions;
  /** Leave the editor and return to the list. */
  onBack: () => void;
}

/**
 * The full-page skill editor's state: the skill's canonical SKILL.md, the
 * draft over it, and the one save that commits it.
 *
 * The detail query is the SAME key the list rides, so the chat on the right
 * writing SKILL.md invalidates it (`SkillsChanged` / `SharedSkillsChanged`)
 * and the left pane follows live — keeping a dirty draft and offering a
 * reload instead of discarding typed work.
 */
export function useSkillEditor(args: SkillEditorArgs) {
  const { row, agent, onApply, onDeleteEverywhere, shared, onBack } = args;
  const { isShared, detail, error, refetch, rename, setRename } =
    useSkillDetailSurface({ row, shared, onLeave: onBack });

  // Seeded the moment the content lands, then reconciled against every later
  // server copy (see `reconcileSkillDraft`). Reconciling during render rather
  // than in an effect keeps the first paint of a fresh copy correct.
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const seeded =
    detail === undefined
      ? draft
      : draft === null
        ? seedSkillDraft(detail.content)
        : reconcileSkillDraft(draft, detail.content);
  if (seeded !== draft) setDraft(seeded);

  // What the in-flight save is writing. The new baseline is adopted only when
  // the save actually LANDS: adopting it optimistically would disable Save
  // after a failed write, with the user's text still on screen.
  const savedContent = useRef<string | null>(null);
  const flow = useSkillSave({
    row,
    agent,
    isShared,
    shared,
    onApply,
    onDeleteEverywhere,
    onSaved: () => {
      setRename(null);
      if (savedContent.current !== null)
        setDraft(seedSkillDraft(savedContent.current));
      savedContent.current = null;
    },
    onDeleted: onBack,
  });

  const contentDirty = seeded !== null && skillDraftDirty(seeded);
  const dirty = contentDirty || rename !== null;

  const save = async () => {
    if (seeded === null) return;
    const content =
      rename !== null ? withSkillTitle(seeded.text, rename) : seeded.text;
    savedContent.current = content;
    await flow.save({ content, contentDirty: dirty });
  };

  return {
    detail,
    error,
    isShared,
    /** Null until the skill's SKILL.md has landed. */
    draft: seeded,
    setText: (text: string) =>
      setDraft((current) => (current ? { ...current, text } : current)),
    /** Drop the draft for the server copy the chat just wrote. */
    reload: () => setDraft(detail ? seedSkillDraft(detail.content) : null),
    /** Ask for the skill again after a load that did not answer. */
    retryLoad: () => {
      void refetch();
    },
    /** Throw the whole edit away: text and rename together. */
    discard: () => {
      setDraft(detail ? seedSkillDraft(detail.content) : null);
      setRename(null);
    },
    rename,
    setRename,
    dirty,
    savable: dirty,
    save,
    flow,
  };
}

export type SkillEditorState = ReturnType<typeof useSkillEditor>;
