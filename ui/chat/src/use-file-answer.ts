"use client";

import { useCallback } from "react";
import { type StepperState, setDraft } from "./interaction-card-logic";
import { claimFiles, liveClaim } from "./interaction-file-claim";
import type { StepperUpdate } from "./use-stepper-state";

/**
 * A question answered by the attached files. Files with no words still
 * answer (the files ARE the answer), but only on the step whose live claim
 * holds them (`interaction-file-claim`), and never over a picked option,
 * which a send with an empty field re-confirms. `fileAnswer` lights the send
 * up with an empty field; `onSendAnswer` records `attachedAnswer` as the
 * answer when nothing was typed, and only that send claims the files.
 */
export function useFileAnswer(args: {
  state: StepperState;
  update: StepperUpdate;
  stepId: string;
  selectedId: string | null;
  draft: string;
  files: readonly File[];
  attachedAnswer: string;
  onSend: () => void;
}): { fileAnswer: boolean; onSendAnswer: () => void } {
  const { state, update, stepId, selectedId, draft, files } = args;
  const { attachedAnswer, onSend } = args;
  const claim = liveClaim(state.fileClaim, files);
  const filesHere = files.length > 0 && (claim?.stepId ?? stepId) === stepId;
  const fileAnswer = filesHere && selectedId === null;
  const onSendAnswer = useCallback(() => {
    if (fileAnswer && draft.trim() === "") {
      update((s) =>
        setDraft(
          claimFiles(s, stepId, files, attachedAnswer),
          stepId,
          attachedAnswer,
        ),
      );
    }
    onSend();
  }, [fileAnswer, draft, update, stepId, files, attachedAnswer, onSend]);
  return { fileAnswer, onSendAnswer };
}
