import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { docKey, normalizeLearnings, parseJsonDoc } from "@houston/domain";
import { atomicTempPath } from "@houston/protocol";
import { ObjectNotFoundError } from "@houston/runtime-client/object-sync";
import type { TurnServerDeps } from "./server-types";
import type { ActivityDocPublishResult } from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import { publishDerived } from "./turn-doc-merge-publish";
import { turnDocTarget } from "./turn-doc-target";
import type { TurnFilesystem } from "./turn-filesystem";
import type { TurnRequest } from "./types";

/**
 * Project a claimed turn's memories write (the save_learning tool, a
 * compaction's fact harvest) into the learnings DB doc the gateway serves a
 * sleeping agent's memories from. Derived from the STORE object, normalized
 * like the standing projector: overlapping turns merge into that object by
 * id, reordering it, so this turn's own copy is not what landed.
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
    const temp = atomicTempPath(
      join(filesystem.storeRoot, ...rel.split("/")),
      `${randomUUID()}.latest`,
    );
    try {
      await source.store.download(
        source.prefix ? posix.join(source.prefix, rel) : rel,
        temp,
      );
      return normalizeLearnings(
        parseJsonDoc(await readFile(temp, "utf8"), rel),
        rel,
      ).items;
    } catch (error) {
      // Gone since it landed: the pod's own read of an absent file is empty.
      if (error instanceof ObjectNotFoundError) return [];
      throw error;
    } finally {
      await rm(temp, { force: true });
    }
  };
  try {
    return await publishDerived(target, derive);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
