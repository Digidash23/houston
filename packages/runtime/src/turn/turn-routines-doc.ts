import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { docKey, normalizeRoutines, parseJsonDoc } from "@houston/domain";
import { atomicTempPath } from "@houston/protocol";
import type { TurnServerDeps } from "./server-types";
import { type ActivityDocPublishResult, publish } from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import { type TurnFilesystem, turnRoutineRunsKey } from "./turn-filesystem";
import { publishTurnRunsDoc } from "./turn-runs-doc";
import { poolIdentity } from "./turn-store";
import type { TurnRequest } from "./types";

type Turn = TurnRequest & { turnId: string };

function routinesPath(filesystem: TurnFilesystem): string {
  return join(filesystem.workspaceDir, ".houston", "routines", "routines.json");
}

const routinesDoc = (raw: string, key: string) =>
  normalizeRoutines(parseJsonDoc(raw, key), key).items;

/**
 * Project a claimed turn's routines write (the auto-pause, the agent's
 * save_routine) into the routines DB doc, NORMALIZED like the standing
 * projector. The gateway answers a sleeping agent's Routines tab from that
 * doc, so without this a routine the worker paused still reads as running
 * until the pod next boots. A lost revision race re-reads the store object:
 * another writer may have landed after this turn's upload.
 */
export async function publishTurnRoutinesDoc(
  deps: TurnServerDeps,
  turn: Turn,
  filesystem: TurnFilesystem,
  source: ActivityDocSource,
): Promise<ActivityDocPublishResult | null> {
  const baseUrl = deps.poolStoreUrl ?? process.env.HOUSTON_POOL_STORE_URL;
  if (turn.shadow || !baseUrl || !turn.claim || !turn.hostToken) return null;
  const rel = docKey(filesystem.workspaceRel, "routines");
  const reload = async () => {
    const temp = atomicTempPath(
      routinesPath(filesystem),
      `${randomUUID()}.latest`,
    );
    try {
      await source.store.download(
        source.prefix ? posix.join(source.prefix, rel) : rel,
        temp,
      );
      return routinesDoc(await readFile(temp, "utf8"), rel);
    } catch {
      // Unreadable now: skip rather than project a copy known to be stale.
      return undefined;
    } finally {
      await rm(temp, { force: true });
    }
  };
  try {
    const { org, agent } = poolIdentity(turn.gcsPrefix);
    return await publish(
      {
        family: "routines",
        baseUrl,
        org,
        agent,
        conversationId: turn.conversationId,
        hostToken: turn.hostToken,
        claim: { token: turn.claim.token, bootId: turn.claim.bootId },
        fetchImpl: deps.fetchImpl ?? fetch,
        ...(deps.activityDocRetryDelaysMs
          ? { retryDelaysMs: deps.activityDocRetryDelaysMs }
          : {}),
      },
      routinesDoc(await readFile(routinesPath(filesystem), "utf8"), rel),
      reload,
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

type RoutineEvent = "RoutinesChanged" | "RoutineRunsChanged";

/**
 * Project every routine file a claimed turn landed (`landed` = uploaded plus
 * immediate writes) into its doc. Resolves to the errors to append to the
 * turn's outcome and the events that must not be announced: an event promises
 * the refetch can be served asleep, which a doc that did not land breaks.
 */
export async function publishLandedRoutineDocs(input: {
  deps: TurnServerDeps;
  turn: Turn;
  filesystem: TurnFilesystem;
  source: ActivityDocSource;
  landed: readonly string[];
}): Promise<{ errors: string[]; stale: RoutineEvent[] }> {
  const { deps, turn, filesystem } = input;
  const errors: string[] = [];
  const stale: RoutineEvent[] = [];
  const settle = (
    event: RoutineEvent,
    label: string,
    result: ActivityDocPublishResult | null,
  ) => {
    if (result && "error" in result)
      errors.push(`${label} doc publish failed: ${result.error}`);
    if (!result || "error" in result || "skipped" in result) stale.push(event);
  };
  if (input.landed.includes(turnRoutineRunsKey(filesystem.workspaceRel))) {
    // The runs doc is projected for routine fires only; any other turn that
    // touched it has no doc to point other tabs at.
    const runs =
      turn.claim && turn.routine
        ? await publishTurnRunsDoc(deps, turn, filesystem)
        : null;
    settle("RoutineRunsChanged", "runs", runs);
  }
  if (input.landed.includes(docKey(filesystem.workspaceRel, "routines"))) {
    const routines = turn.claim
      ? await publishTurnRoutinesDoc(deps, turn, filesystem, input.source)
      : null;
    // No doc system to project into (unclaimed, no pool store): the event
    // stands as it always has, since reads there never come from the doc.
    if (routines) settle("RoutinesChanged", "routines", routines);
  }
  return { errors, stale };
}
