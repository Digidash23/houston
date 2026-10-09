import type { BoardPersistOptions, BoardStatus } from "./feed-output";

/** The conversation VM's reply-phase field (see reply-phase.ts). */
export interface ReplyPhaseVM {
  /**
   * The running turn's reply has finished streaming and only its wrap-up
   * remains (additive; absent otherwise): the runtime's `reply_complete`,
   * withdrawn if the turn carries on after it. `running` and `boardStatus`
   * keep the TURN's truth until it settles (sends still queue behind it, and
   * the completion notification still waits for the settle), but a surface
   * ends its Stop affordance here. Folded from the turn's provisional board
   * persist, so it flips with the card.
   */
  replyComplete?: true;
}

/** A conversation's reply phase as the VM holds it; published only while
 *  the turn is running. */
export interface ReplyPhaseState {
  replyComplete: boolean;
}

/**
 * Fold a board persist into the reply phase. An early write (`provisional`)
 * is not a settle: `boardStatus` leaving "running" is what the completion
 * notification waits for, so it changes the reply phase and nothing else —
 * returns true, and the caller folds no more. Any other write ends the phase.
 */
export function foldReplyPhase(
  s: ReplyPhaseState,
  status: BoardStatus,
  opts: BoardPersistOptions | undefined,
): boolean {
  s.replyComplete = opts?.provisional === true && status === "needs_you";
  return opts?.provisional === true;
}

/** The snapshot's {@link ReplyPhaseVM} field. */
export function replyPhaseField(
  s: ReplyPhaseState & { sessionStatus: string },
): ReplyPhaseVM {
  return s.replyComplete && s.sessionStatus === "running"
    ? { replyComplete: true }
    : {};
}
