import { docKey, normalizeRoutines, parseJsonDoc } from "@houston/domain";
import type { TurnServerDeps } from "./server-types";
import type { ActivityDocPublishResult } from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import { turnDocTarget } from "./turn-doc-target";
import type { TurnFilesystem } from "./turn-filesystem";
import { publishStoreDoc } from "./turn-store-doc";
import type { TurnRequest } from "./types";

/**
 * Project a claimed turn's routines write (the auto-pause, the agent's
 * save_routine) into the routines DB doc, NORMALIZED like the standing
 * projector. The gateway answers a sleeping agent's Routines tab from that
 * doc, so without this a routine the worker paused still reads as running
 * until the pod next boots. Derived from the store object, never the turn's
 * copy: a user's edit can land and project between this turn's upload and
 * its publish.
 */
export async function publishTurnRoutinesDoc(
  deps: TurnServerDeps,
  turn: TurnRequest,
  filesystem: TurnFilesystem,
  source: ActivityDocSource,
): Promise<ActivityDocPublishResult | null> {
  const target = turnDocTarget(deps, turn, "routines");
  if (!target) return null;
  const rel = docKey(filesystem.workspaceRel, "routines");
  return publishStoreDoc(target, source, rel, (raw) =>
    raw === null ? [] : normalizeRoutines(parseJsonDoc(raw, rel), rel).items,
  );
}
