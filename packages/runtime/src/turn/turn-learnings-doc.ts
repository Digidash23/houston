import { docKey, normalizeLearnings, parseJsonDoc } from "@houston/domain";
import type { TurnServerDeps } from "./server-types";
import type { ActivityDocPublishResult } from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import { publishDerived } from "./turn-doc-merge-publish";
import { turnDocTarget } from "./turn-doc-target";
import type { TurnFilesystem } from "./turn-filesystem";
import { readStoreText } from "./turn-store-read";
import type { TurnRequest } from "./types";

/**
 * Project a claimed turn's memories write (the save_learning tool, a
 * compaction's fact harvest, a deleted file) into the learnings DB doc the
 * gateway serves a sleeping agent's memories from. Derived from the STORE
 * object, normalized like the standing projector (absent = empty):
 * overlapping turns merge into that object by id, reordering it, so this
 * turn's own copy is not what landed.
 */
export async function publishTurnLearningsDoc(
  deps: TurnServerDeps,
  turn: TurnRequest,
  filesystem: TurnFilesystem,
  source: ActivityDocSource,
): Promise<ActivityDocPublishResult | null> {
  const target = turnDocTarget(deps, turn, "learnings");
  if (!target) return null;
  const rel = docKey(filesystem.workspaceRel, "learnings");
  const derive = async () => {
    const raw = await readStoreText(source, rel);
    return raw === null
      ? []
      : normalizeLearnings(parseJsonDoc(raw, rel), rel).items;
  };
  try {
    return await publishDerived(target, derive);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
