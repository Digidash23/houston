"use client";

import { useCallback } from "react";
import { type StepperState, setDraft } from "./interaction-card-logic";
import type { StepperUpdate } from "./use-stepper-state";

/**
 * A question answered by the attached files. Files with no words still
 * answer (the files ARE the answer), but only on the one step they were sent
 * from, and never over a picked option, which a send with an empty field
 * re-confirms. `fileAnswer` lights the send up with an empty field;
 * `onSendAnswer` records `attachedAnswer` as the answer when nothing was
 * typed.
 */
export function useFileAnswer(args: {
  state: StepperState;
  update: StepperUpdate;
  stepId: string;
  selectedId: string | null;
  draft: string;
  hasFiles: boolean;
  attachedAnswer: string;
  onSend: () => void;
}): { fileAnswer: boolean; onSendAnswer: () => void } {
  const { state, update, stepId, selectedId, draft, attachedAnswer, onSend } =
    args;
  const filesHere =
    args.hasFiles && (state.attachedStepId ?? stepId) === stepId;
  const fileAnswer = filesHere && selectedId === null;
  const onSendAnswer = useCallback(() => {
    // A typed answer or the files alone claim them for this step; an empty
    // send that re-confirms a picked option leaves them for a later step.
    const typed = draft.trim() !== "";
    if (filesHere && (typed || fileAnswer)) {
      update((s) => {
        const claimed = claimAttachedStep(s, stepId);
        return typed ? claimed : setDraft(claimed, stepId, attachedAnswer);
      });
    }
    onSend();
  }, [filesHere, fileAnswer, draft, update, stepId, attachedAnswer, onSend]);
  return { fileAnswer, onSendAnswer };
}

/** Record `stepId` as the step the attached files answer, unless an earlier
 *  step already claimed them. */
function claimAttachedStep(state: StepperState, stepId: string): StepperState {
  if (state.attachedStepId !== undefined) return state;
  return { ...state, attachedStepId: stepId };
}
