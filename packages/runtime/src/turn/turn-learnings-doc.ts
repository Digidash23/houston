import { docKey, normalizeLearnings, parseJsonDoc } from "@houston/domain";
import type { TurnServerDeps } from "./server-types";
import type {
  ActivityDocOptions,
  ActivityDocPublishResult,
} from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import { publishDerived } from "./turn-doc-merge-publish";
import { turnDocTarget } from "./turn-doc-target";
import type { TurnFilesystem } from "./turn-filesystem";
import { readStoreText } from "./turn-store-read";
import type { TurnRequest } from "./types";

/**
 * Project the learnings file into its DB doc from the STORE object,
 * normalized like the standing projector (absent = empty). Every pooled
 * writer (a turn's save_learning, an op's whole-list save) publishes this
 * way: overlapping writers merge into that object by id, reordering it, so
 * no writer's own copy is what landed, and a copy from a tree listed before
 * another writer's landing would drop that writer's memory.
 */
export async function publishLearningsDoc(
  target: ActivityDocOptions,
  source: ActivityDocSource,
  workspaceRel: string,
): Promise<ActivityDocPublishResult> {
  const rel = docKey(workspaceRel, "learnings");
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

/** A claimed turn's memories write or deletion, projected (null = no doc system). */
export async function publishTurnLearningsDoc(
  deps: TurnServerDeps,
  turn: TurnRequest,
  filesystem: TurnFilesystem,
  source: ActivityDocSource,
): Promise<ActivityDocPublishResult | null> {
  const target = turnDocTarget(deps, turn, "learnings");
  return target
    ? publishLearningsDoc(target, source, filesystem.workspaceRel)
    : null;
}
