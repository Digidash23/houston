"use client";

import { useCallback, useMemo } from "react";
import {
  type ChatInteractionStep,
  type StepperState,
  setDraft,
} from "./interaction-card-logic";
import { normalizeAnswer } from "./interaction-card-model";
import { claimFiles, stepFiles } from "./interaction-file-claim";
import type { StepperUpdate } from "./use-stepper-state";

const NO_FILES: readonly File[] = [];

/**
 * A question answered by the attached files. Files with no words still
 * answer (the files ARE the answer), but only the files no other step's live
 * claim holds (`interaction-file-claim`), and never over a picked option,
 * which a send with an empty field re-confirms. A plain question needs every
 * attached file to itself; a `wantsFiles` question takes whichever files are
 * still unclaimed, so each file question in a card gets its own. `fileAnswer`
 * lights the send up with an empty field; `onSendAnswer` records
 * `attachedAnswer` as the answer when nothing was typed and claims the
 * files; on a `wantsFiles` question a typed answer claims them too. `stepFiles` are the files that answer this step.
 */
export function useFileAnswer(args: {
  state: StepperState;
  update: StepperUpdate;
  step: ChatInteractionStep | undefined;
  selectedId: string | null;
  draft: string;
  /** The panel's list; absent when the card has no panel behind it. */
  files: readonly File[] | undefined;
  attachedAnswer: string;
  onSend: () => void;
}): {
  fileAnswer: boolean;
  onSendAnswer: () => void;
  stepFiles: readonly File[];
} {
  const { state, update, step, selectedId, draft, attachedAnswer } = args;
  const { onSend } = args;
  const files = args.files ?? NO_FILES;
  const stepId = step?.id ?? "";
  const wantsFiles = step?.kind === "question" && step.wantsFiles === true;
  const mine = useMemo(
    () => stepFiles(state.fileClaims, stepId, files),
    [state.fileClaims, stepId, files],
  );
  const filesHere = mine.files.length > 0 && (wantsFiles || mine.exclusive);
  const fileAnswer = filesHere && selectedId === null;
  const own = mine.files;
  const onSendAnswer = useCallback(() => {
    const typed = normalizeAnswer(draft);
    if (fileAnswer && typed === null) {
      update((s) =>
        setDraft(
          claimFiles(s, stepId, own, attachedAnswer),
          stepId,
          attachedAnswer,
        ),
      );
    } else if (fileAnswer && wantsFiles && typed !== null) {
      // "Here is my logo" with the logo attached still answers with the
      // logo, so the next file question can't take it.
      update((s) => claimFiles(s, stepId, own, typed));
    }
    onSend();
  }, [
    fileAnswer,
    wantsFiles,
    draft,
    update,
    stepId,
    own,
    attachedAnswer,
    onSend,
  ]);
  return { fileAnswer, onSendAnswer, stepFiles: own };
}
