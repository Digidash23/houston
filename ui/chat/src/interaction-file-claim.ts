// The question step the panel's attached files alone answered ("See
// attached"). Pure, like interaction-card-logic.ts, which applies the
// releases inside its transitions.

import type { StepAnswer, StepperState } from "./interaction-card-logic.ts";

/** Only the claimed step may be answered by files alone, so one "See
 *  attached" never spreads to the questions after it. The claim lives only
 *  while every file it was made with is still attached and its answer still
 *  stands: a removed file or a changed answer hands the files back to
 *  whichever step the user is on. */
export interface FileClaim {
  stepId: string;
  files: readonly File[];
  answer: string;
}

/** Claim the files for `stepId`. Callers only claim when no live claim
 *  belongs to another step, so this may replace a stale one. */
export function claimFiles(
  state: StepperState,
  stepId: string,
  files: readonly File[],
  answer: string,
): StepperState {
  return { ...state, fileClaim: { stepId, files: [...files], answer } };
}

/** The claim, or `undefined` once any file it was made with is gone. */
export function liveClaim(
  claim: FileClaim | undefined,
  files: readonly File[],
): FileClaim | undefined {
  if (!claim) return undefined;
  return claim.files.every((f) => files.includes(f)) ? claim : undefined;
}

/** Drop the claim when `stepId` holds it and is skipped (`committed`
 *  undefined) or re-answered with anything but the files answer. */
export function releaseClaim(
  state: StepperState,
  stepId: string,
  committed?: StepAnswer,
): StepperState {
  const claim = state.fileClaim;
  if (claim?.stepId !== stepId) return state;
  if (committed?.optionId === null && committed.answer === claim.answer) {
    return state;
  }
  const { fileClaim: _, ...rest } = state;
  return rest;
}
