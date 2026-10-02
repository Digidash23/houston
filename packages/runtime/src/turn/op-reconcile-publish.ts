import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeRoutineRuns, parseJsonDoc } from "@houston/domain";
import type { ChatMessage, HoustonEvent } from "@houston/protocol";
import { mergeRoutineRunArrays } from "@houston/runtime-client/object-sync";
import { docTarget, type OpClaimTurn, publishFamilyDocs } from "./op-republish";
import type { TurnServerDeps } from "./server-types";
import { publish } from "./turn-activity-doc";
import {
  type ActivityDocSource,
  readLocalActivityDoc,
  readStoredActivityDoc,
} from "./turn-activity-source";
import { publishMerged } from "./turn-doc-merge-publish";
import {
  type TurnFilesystem,
  turnActivityKey,
  turnRoutineRunsKey,
} from "./turn-filesystem";
import { poolIdentity } from "./turn-store";
import { putTranscriptRow } from "./turn-transcript-http";
import { docNotLandedReason } from "./turn-view-publish";

/**
 * After a reconcile op's sync-back: the transcript store gets the
 * interruption reply (the file landed first, as a turn's does), and every doc
 * a sleeping agent's reads come from re-projects what landed. The run history
 * merges by run id into the doc, as a routine turn's does: overlapping fires
 * of the agent publish there too. Answers the projections that failed.
 */
export async function publishReconcile(input: {
  deps: TurnServerDeps;
  turn: OpClaimTurn;
  filesystem: TurnFilesystem;
  source: ActivityDocSource;
  events: readonly HoustonEvent[];
  landed?: ChatMessage;
  uploaded: readonly string[];
}): Promise<string[]> {
  const { deps, turn, filesystem } = input;
  const failures: string[] = [];
  if (input.landed) failures.push(...(await mirrorReply(input, input.landed)));
  const target = docTarget(deps, turn);
  if (!target) return failures;
  const { workspaceRel } = filesystem;
  const runsKey = turnRoutineRunsKey(workspaceRel);
  if (input.uploaded.includes(runsKey)) {
    // The sync-back merge left the file as the bytes it uploaded.
    const rows = normalizeRoutineRuns(
      parseJsonDoc(await readFile(runsPath(filesystem), "utf8"), runsKey),
      runsKey,
    ).items;
    const outcome = await publishMerged(
      { ...target, family: "routine_runs" },
      (current) =>
        mergeRoutineRunArrays(
          normalizeRoutineRuns(current, runsKey).items,
          rows,
        ),
    );
    const failed = docNotLandedReason(outcome);
    if (failed) failures.push(`routine_runs: ${failed}`);
  }
  if (input.uploaded.includes(turnActivityKey(workspaceRel))) {
    const outcome = await publish(
      { ...target, family: "activity" },
      await readLocalActivityDoc(filesystem),
      () => readStoredActivityDoc(input.source, filesystem),
    );
    const failed = docNotLandedReason(outcome);
    if (failed) failures.push(`activity: ${failed}`);
  }
  if (input.events.some((e) => e.type === "RoutinesChanged")) {
    failures.push(
      ...(await publishFamilyDocs(deps, turn, filesystem.vfs, workspaceRel, [
        "routines",
      ])),
    );
  }
  return failures;
}

const runsPath = (filesystem: TurnFilesystem) =>
  join(
    filesystem.workspaceDir,
    ".houston",
    "routine_runs",
    "routine_runs.json",
  );

/** PUT the reply under its turn. Idempotent per turn: a reply that already
 *  landed for this turn (a retry, or the turn's own) stays as it is. */
async function mirrorReply(
  input: {
    deps: TurnServerDeps;
    turn: OpClaimTurn;
    filesystem: TurnFilesystem;
  },
  message: ChatMessage,
): Promise<string[]> {
  const { deps, turn } = input;
  const baseUrl = deps.poolStoreUrl ?? process.env.HOUSTON_POOL_STORE_URL;
  if (!baseUrl || !message.turnId) return [];
  const { org, agent } = poolIdentity(turn.gcsPrefix);
  try {
    const response = await putTranscriptRow(
      deps.fetchImpl ?? fetch,
      {
        baseUrl,
        org,
        agent,
        conversationId: turn.conversationId,
        turnId: message.turnId,
        dataDir: input.filesystem.dataDir,
        hostToken: turn.hostToken,
        claim: turn.claim,
        ...(deps.transcriptRetryDelaysMs
          ? { retryDelaysMs: deps.transcriptRetryDelaysMs }
          : {}),
      },
      { kind: "assistant", turnId: message.turnId, message },
    );
    return response.ok
      ? []
      : [`transcript reply rejected (${response.status})`];
  } catch (error) {
    return [
      `transcript reply failed: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}
