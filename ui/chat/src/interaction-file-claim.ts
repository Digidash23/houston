// Which question step each attached file answers. Pure, like interaction-card-logic.ts, which applies the
// releases inside its transitions.

import type { StepAnswer, StepperState } from "./interaction-card-logic.ts";

/** The files one step's answer stands for, so they never also answer the
 *  questions after it. A claim lives only while every
 *  file it was made with is still attached and its answer still stands: a
 *  removed file or a changed answer hands the files back. */
export interface FileClaim {
  files: readonly File[];
  answer: string;
}

/** Claims by step id. Live claims never share a file: a step only claims
 *  files no other step's live claim holds (`stepFiles`). */
export type FileClaims = Readonly<Record<string, FileClaim>>;

function isLive(claim: FileClaim, files: readonly File[]): boolean {
  return claim.files.every((f) => files.includes(f));
}

/** The attached files that answer `stepId`: its own claim's plus every file
 *  no other step's live claim holds. `exclusive` is true when no other step
 *  holds a live claim at all, the condition a plain question keeps. */
export function stepFiles(
  claims: FileClaims | undefined,
  stepId: string,
  files: readonly File[],
): { files: File[]; exclusive: boolean } {
  const held = new Set<File>();
  for (const [id, claim] of Object.entries(claims ?? {})) {
    if (id === stepId || !isLive(claim, files)) continue;
    for (const f of claim.files) held.add(f);
  }
  return {
    files: files.filter((f) => !held.has(f)),
    exclusive: held.size === 0,
  };
}

/** Claim `files` for `stepId`, replacing whatever it claimed before. */
export function claimFiles(
  state: StepperState,
  stepId: string,
  files: readonly File[],
  answer: string,
): StepperState {
  return {
    ...state,
    fileClaims: {
      ...state.fileClaims,
      [stepId]: { files: [...files], answer },
    },
  };
}

/** Drop `stepId`'s claim when it is skipped (`committed` undefined) or
 *  re-answered with anything but its files answer. */
export function releaseClaim(
  state: StepperState,
  stepId: string,
  committed?: StepAnswer,
): StepperState {
  const claim = state.fileClaims?.[stepId];
  if (!claim) return state;
  if (committed?.optionId === null && committed.answer === claim.answer) {
    return state;
  }
  const { [stepId]: _, ...rest } = state.fileClaims ?? {};
  return { ...state, fileClaims: rest };
}
