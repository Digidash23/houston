/**
 * The single-card move-to-done celebration, in one place: the card checkmark
 * and the drag-to-Done drop, on both the per-agent board and cross-agent
 * Mission Control, all run the same two-step.
 */

import {
  type ConfettiOrigin,
  fireMissionDoneConfetti,
  missionCardOrigin,
} from "./confetti.ts";
import { celebratesMissionDone } from "./mission-selection.ts";

/** The parts of a board card this celebration reads. Structural on purpose, so
 *  it takes a `KanbanItem` without this module knowing the board's types. */
interface CelebratedItem {
  id: string;
  status: string;
}

/**
 * Arm the celebration for moving ONE mission to `targetStatus`: measures the
 * card where it sits right now and hands back the burst to fire with the move.
 *
 * The split is the whole point. The card has to be measured BEFORE the move
 * is painted: the optimistic paint re-renders it into the Done column, so a
 * lookup afterwards would either miss the node or read its new home, and the
 * confetti would come from the wrong place. The burst fires with that paint,
 * not when the host confirms: on a waking pod the confirmation lands seconds
 * after the card already sits in Done, and a burst then reads as unrelated.
 * A refused write moves the card back and says so in its own toast.
 *
 * A move that isn't a finish (anything but Done, or a mission that ended in
 * `error` — see `celebratesMissionDone`) arms nothing: the returned function is
 * a no-op, and no DOM is touched. A card that can't be found still celebrates,
 * from the default bottom-of-board origin.
 */
export function armMissionDoneCelebration(
  item: CelebratedItem,
  targetStatus: string,
): () => void {
  const celebrates = celebratesMissionDone(targetStatus, [item.status]);
  const origin: ConfettiOrigin | undefined = celebrates
    ? missionCardOrigin(item.id)
    : undefined;
  return () => {
    if (celebrates) fireMissionDoneConfetti(origin);
  };
}
