import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeRoutineRuns, parseJsonDoc } from "@houston/domain";
import type { ChatMessage, HoustonEvent } from "@houston/protocol";
import { mergeRoutineRunArrays } from "@houston/runtime-client/object-sync";
import { docTarget, type OpClaimTurn, republish } from "./op-republish";
import type { TurnServerDeps } from "./server-types";
import type { ActivityDocSource } from "./turn-activity-source";
import { publishMerged } from "./turn-doc-merge-publish";
import { type TurnFilesystem, turnRoutineRunsKey } from "./turn-filesystem";
import { poolIdentity } from "./turn-store";
import { putTranscriptRow } from "./turn-transcript-http";
import { docNotLandedReason } from "./turn-view-publish";

/**
 * A reconcile op's projections. The settlement's own two (the reply into the
 * transcript store, the run history doc merged by run id) re-run on every
 * attempt, whether or not this one changed a file: an attempt whose files
 * landed but whose settlement projection failed declines, and the retry owes
 * them still. The board and routines docs follow only what this attempt
 * changed, through the ops' own republish, and a lag there is the ops'
 * usual one: the next writer re-projects. Every step is idempotent.
 */
export async function publishReconcile(input: {
  deps: TurnServerDeps;
  turn: OpClaimTurn;
  filesystem: TurnFilesystem;
  source: ActivityDocSource;
  /** What this attempt changed (the board and the routines follow it). */
  events: readonly HoustonEvent[];
  /** The chat's interruption reply for the dead turn. */
  line?: ChatMessage;
  /** The op settles runs (a routine fire, a stale row): their doc follows. */
  runs: boolean;
  landed: readonly string[];
}): Promise<{ settle: string[]; lag: string[] }> {
  const { deps, turn, filesystem } = input;
  const settle: string[] = [];
  const lag: string[] = [];
  // The file landed first, as a turn's does: the store's file-to-database
  // repair then keeps the line too.
  if (input.line) settle.push(...(await mirrorReply(input, input.line)));
  const target = docTarget(deps, turn);
  if (!target) return { settle, lag };
  if (input.runs) settle.push(...(await publishRunsDoc(target, filesystem)));
  const others = input.events.filter(
    (e) => e.type === "ActivityChanged" || e.type === "RoutinesChanged",
  );
  if (others.length > 0) {
    lag.push(
      ...(await republish(
        deps,
        turn,
        filesystem,
        {
          status: 200,
          contentType: "application/json",
          body: "",
          events: others,
          include: () => false,
        },
        input.landed,
        input.source,
      )),
    );
  }
  return { settle, lag };
}

/** The run history as the sync-back merge left it, merged into the doc by
 *  run id: overlapping fires of the agent publish there too. */
async function publishRunsDoc(
  target: NonNullable<ReturnType<typeof docTarget>>,
  filesystem: TurnFilesystem,
): Promise<string[]> {
  const path = join(
    filesystem.workspaceDir,
    ".houston",
    "routine_runs",
    "routine_runs.json",
  );
  if (!existsSync(path)) return [];
  const key = turnRoutineRunsKey(filesystem.workspaceRel);
  const rows = normalizeRoutineRuns(
    parseJsonDoc(await readFile(path, "utf8"), key),
    key,
  ).items;
  const outcome = await publishMerged(
    { ...target, family: "routine_runs" },
    (current) =>
      mergeRoutineRunArrays(normalizeRoutineRuns(current, key).items, rows),
  );
  const failed = docNotLandedReason(outcome);
  return failed ? [`routine_runs: ${failed}`] : [];
}

/** PUT the reply under its turn. Idempotent per turn: a reply that already
 *  landed for the turn stays as it is. */
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
