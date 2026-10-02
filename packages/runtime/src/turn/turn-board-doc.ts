import type { TurnServerDeps } from "./server-types";
import type { ActivityDocPublishResult } from "./turn-activity-doc";
import {
  type ActivityDocSource,
  readStoredActivityDoc,
} from "./turn-activity-source";
import { publishDerived } from "./turn-doc-merge-publish";
import { turnDocTarget } from "./turn-doc-target";
import type { TurnFilesystem } from "./turn-filesystem";
import type { TurnRequest } from "./types";

class BoardUnreadable extends Error {}

/**
 * Project a claimed turn's landed board into the activity DB doc, derived
 * from the STORE object read after the doc revision (publishDerived), never
 * the turn's own copy: another turn (or the gateway's own board write) can
 * land and project between this turn's upload and its publish, and the
 * older copy would roll that card back. A board the store will not give
 * back now is skipped: stale and unannounced, never a failed turn.
 */
export async function publishTurnActivityDoc(
  deps: TurnServerDeps,
  turn: TurnRequest,
  filesystem: TurnFilesystem,
  source: ActivityDocSource,
): Promise<ActivityDocPublishResult | null> {
  const target = turnDocTarget(deps, turn, "activity");
  if (!target) return null;
  try {
    return await publishDerived(target, async () => {
      const board = await readStoredActivityDoc(source, filesystem);
      if (board === undefined) throw new BoardUnreadable();
      return board;
    });
  } catch (error) {
    if (error instanceof BoardUnreadable)
      return { skipped: "stale_after_conflict" };
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
