import type { HoustonEvent } from "@houston/protocol";
import {
  type ObjectStore,
  syncBack,
} from "@houston/runtime-client/object-sync";
import type { startClaimHeartbeat } from "./claim-heartbeat";
import { partialSyncReply } from "./op-durability";
import type { ReconcileOp } from "./op-grammar-reconcile";
import { applyReconcileOp } from "./op-reconcile-apply";
import { publishReconcile } from "./op-reconcile-publish";
import type { OpClaimTurn } from "./op-republish";
import type { OpRequest } from "./parse-op-request";
import type { TurnServerDeps } from "./server-types";
import { announcedOpEvents } from "./turn-changed-events";
import {
  claimedTurnIncludes,
  type TurnFilesystem,
  turnRoutineRunsKey,
} from "./turn-filesystem";
import { autoPauseRoutineTurn } from "./turn-routine-auto-pause";

type Reply = { status: number; body: Record<string, unknown> };

/**
 * POST /op `reconcile`: the pod's run reconciliation and its boot settle of
 * an interrupted turn, for a pooled turn that died where neither runs. The
 * conversation's claim scopes every write to what a turn of that conversation
 * may write. Safe to repeat: a retry writes nothing it already wrote, and
 * re-runs every projection, so an attempt that declines on a failed one is
 * finished by the next.
 */
export async function executeReconcileOp(input: {
  deps: TurnServerDeps;
  op: OpRequest & { op: ReconcileOp };
  turn: OpClaimTurn;
  resolved: { store: ObjectStore; prefix: string };
  filesystem: TurnFilesystem;
  heartbeat: ReturnType<typeof startClaimHeartbeat>;
}): Promise<Reply> {
  const { filesystem, heartbeat, resolved } = input;
  const applied = await applyReconcileOp(input.op.op, filesystem);
  if (applied.decline) return decline(`${applied.chat}`, resolved.prefix);
  await heartbeat.checkpoint();
  if (heartbeat.fenced) return { status: 409, body: { error: "claim_fenced" } };
  const events: HoustonEvent[] = [...applied.events];
  let landed: string[] = [];
  if (events.length > 0) {
    const synced = await syncBack(
      resolved.store,
      resolved.prefix,
      filesystem.storeRoot,
      filesystem.manifest,
      {
        include: claimedTurnIncludes(
          filesystem.dataRel,
          filesystem.workspaceRel,
          input.turn.conversationId,
        ),
        holdDeletesOnFailure: true,
        generations: filesystem.generationAware,
        workerMerge: true,
      },
    );
    const partial = partialSyncReply(
      synced,
      `prefix=${resolved.prefix} kind=reconcile`,
    );
    if (partial) return { status: 200, body: partial };
    landed = [...synced.uploaded];
  }
  if (landed.includes(turnRoutineRunsKey(filesystem.workspaceRel))) {
    events.push(...(await pauseAfterSync(input, applied.pause)));
  }
  const op = input.op.op;
  const failures = await publishReconcile({
    deps: input.deps,
    turn: input.turn,
    filesystem,
    source: resolved,
    events,
    ...(applied.line ? { line: applied.line } : {}),
    runs: !op.abandoned || op.abandoned.routine,
    landed,
  });
  if (failures.length > 0) {
    // The files are durable; the retry re-projects them.
    return decline(
      `projection failed: ${failures.join("; ")}`,
      resolved.prefix,
    );
  }
  return {
    status: 200,
    body: {
      ok: true,
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chat: applied.chat }),
      events: announcedOpEvents(events, []),
    },
  };
}

/**
 * The pooled auto-pause for each routine whose run settled on a typed wall,
 * once that row is durable: rebased on the store's routines, so a concurrent
 * edit survives. A failed pause is reported and retried by the next failure.
 */
async function pauseAfterSync(
  input: {
    filesystem: TurnFilesystem;
    resolved: { store: ObjectStore; prefix: string };
  },
  routineIds: readonly string[],
): Promise<HoustonEvent[]> {
  const events: HoustonEvent[] = [];
  for (const routineId of new Set(routineIds)) {
    try {
      const paused = await autoPauseRoutineTurn({
        store: input.resolved.store,
        prefix: input.resolved.prefix,
        filesystem: input.filesystem,
        routineId,
        nowIso: new Date().toISOString(),
      });
      if (!paused) continue;
      console.info(
        `[routine-auto-pause] paused ${paused.id} after ${paused.auto_paused?.failures} runs: ${paused.auto_paused?.reason} (${paused.auto_paused?.provider})`,
      );
      events.push({
        type: "RoutinesChanged",
        agentPath: input.filesystem.workspaceRel.replace(/^workspaces\//, ""),
      });
    } catch (error) {
      console.error(
        `[op] reconcile auto-pause failed for ${routineId}:`,
        error,
      );
    }
  }
  return events;
}

function decline(reason: string, prefix: string): Reply {
  console.warn(`[op] reconcile declined: ${reason} prefix=${prefix}`);
  return { status: 200, body: { ok: true, decline: true } };
}
